use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};
use url::Url;

use crate::config::Config;
use crate::error::{BridgeError, Kind};
use crate::keychain::Keychain;
use crate::{loopback, pkce};

#[derive(Debug, Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub body: Option<Value>,
    /// True when a stale token was swapped for a new one and the call retried: the User's Permissions may have changed.
    pub refreshed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenPair {
    access_token: String,
    refresh_token: String,
}

struct Pending {
    verifier: String,
    state: String,
    done: oneshot::Sender<Result<(), BridgeError>>,
}

/// What a signed call sends besides the headers: nothing, JSON, or one file as the multipart part `file` (an empty `key` sends no Idempotency-Key).
pub enum Payload<'a> {
    Empty,
    Json(&'a Value, &'a str),
    File { name: &'a str, bytes: &'a [u8], key: &'a str },
}

/// A response with its body untouched.
pub struct Raw {
    pub status: u16,
    pub bytes: Vec<u8>,
}

#[derive(Default)]
struct State {
    access: Option<String>,
    pending: Option<Pending>,
}

/// Token state of the signed-in User. The access token lives in memory only; the refresh token only in the keychain.
pub struct Session {
    cfg: Config,
    keychain: Arc<dyn Keychain>,
    http: reqwest::Client,
    state: Mutex<State>,
    refresh_gate: Mutex<()>,
    dirty: AtomicBool,
}

fn err(kind: Kind, msg: &str) -> BridgeError {
    BridgeError::new(kind, msg)
}

fn keychain_err() -> BridgeError {
    err(Kind::KeychainUnavailable, "keychain unavailable")
}

const HEALTH: &str = "/health/ready";

fn failed(msg: &str) -> BridgeError {
    err(Kind::Failed, msg)
}

/// Test connection makes up to three provider calls of 60 s each on the backend, and loading models one call plus a retry; every other call keeps the short limit.
// shortcut: slow paths by name, upgrade to a per-call option when a third slow call exists (story 3.2 describe, 4.x).
const SLOW_PATHS: [&str; 2] = ["/api/v1/admin/ai/test", "/api/v1/admin/ai/models"];
const SLOW_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(200);

fn timeout_for(path: &str, default: std::time::Duration) -> std::time::Duration {
    if SLOW_PATHS.contains(&path) { SLOW_TIMEOUT.max(default) } else { default }
}

fn check_path(p: &str) -> Result<(), BridgeError> {
    let ok = p.starts_with("/api/v1/")
        && !p.contains("..")
        && !p.contains("//")
        && p.bytes().all(|b| (0x21..0x7f).contains(&b) && b != b'\\');
    if ok { Ok(()) } else { Err(err(Kind::BadRequest, "path must stay under /api/v1/")) }
}

fn parse_method(m: &str) -> Result<reqwest::Method, BridgeError> {
    match m.to_ascii_uppercase().as_str() {
        "GET" => Ok(reqwest::Method::GET),
        "POST" => Ok(reqwest::Method::POST),
        "PUT" => Ok(reqwest::Method::PUT),
        "PATCH" => Ok(reqwest::Method::PATCH),
        "DELETE" => Ok(reqwest::Method::DELETE),
        _ => Err(err(Kind::BadRequest, "method not allowed")),
    }
}

impl Session {
    pub fn new(cfg: Config, keychain: Arc<dyn Keychain>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(cfg.request_timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("http client");
        Self { cfg, keychain, http, state: Mutex::default(), refresh_gate: Mutex::default(), dirty: AtomicBool::new(false) }
    }

    pub fn set_dirty(&self, dirty: bool) {
        self.dirty.store(dirty, Ordering::SeqCst);
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty.load(Ordering::SeqCst)
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    /// Opens the system browser and waits for the callback (Deep Link or loopback). Calling it again supersedes the
    /// wait in progress, which ends as `Cancelled`; `sign_out` cancels it too.
    pub async fn sign_in(self: &Arc<Self>) -> Result<(), BridgeError> {
        self.keychain.load().map_err(|_| keychain_err())?;
        let redirect = if self.cfg.loopback {
            let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|_| failed("no loopback port"))?;
            let port = listener.local_addr().map_err(|_| failed("no loopback port"))?.port();
            let (session, wait) = (self.clone(), self.cfg.sign_in_timeout);
            tokio::spawn(async move {
                let _ = tokio::time::timeout(wait, loopback::serve(listener, session)).await;
            });
            format!("http://127.0.0.1:{port}/callback")
        } else {
            "klei://auth/callback".to_owned()
        };

        let pkce = pkce::generate();
        let state = pkce::state();
        let (done, wait) = oneshot::channel();
        self.state.lock().await.pending = Some(Pending { verifier: pkce.verifier, state: state.clone(), done });

        let mut url = Url::parse(&format!("{}/authorize", self.cfg.auth)).map_err(|_| failed("bad auth url"))?;
        url.query_pairs_mut()
            .append_pair("client", "desktop")
            .append_pair("challenge", &pkce.challenge)
            .append_pair("state", &state)
            .append_pair("redirect", &redirect);
        (self.cfg.open)(url.as_str());

        match tokio::time::timeout(self.cfg.sign_in_timeout, wait).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(err(Kind::Cancelled, "sign-in cancelled")),
            Err(_) => {
                let mut st = self.state.lock().await;
                if st.pending.as_ref().is_some_and(|p| p.state == state) {
                    st.pending = None;
                }
                Err(err(Kind::Timeout, "sign-in timed out"))
            }
        }
    }

    /// The callback URL carried `code` and `state`; one attempt only, whatever the outcome.
    pub async fn complete(&self, url: &Url) -> Result<(), BridgeError> {
        let pending = self.state.lock().await.pending.take().ok_or_else(|| failed("no sign-in in progress"))?;
        let result = self.finish(&pending, url).await;
        let _ = pending.done.send(result.clone());
        result
    }

    async fn finish(&self, pending: &Pending, url: &Url) -> Result<(), BridgeError> {
        let q: HashMap<String, String> = url.query_pairs().into_owned().collect();
        if q.get("state").map(String::as_str) != Some(pending.state.as_str()) {
            return Err(failed("state mismatch"));
        }
        let code = q.get("code").filter(|c| !c.is_empty()).ok_or_else(|| failed("no code"))?;
        let (status, body) =
            self.post("/api/v1/auth/token", json!({ "code": code, "verifier": pending.verifier })).await?;
        if status != 200 {
            return Err(failed("code rejected"));
        }
        self.accept(parse_pair(body)?).await.map(|_| ())
    }

    pub async fn sign_out(&self) -> Result<(), BridgeError> {
        {
            let mut st = self.state.lock().await;
            st.pending = None;
            st.access = None;
        }
        // shortcut: logout is best effort (offline leaves the server session to expire), upgrade when sessions need hard revoke.
        if let Ok(Some(rt)) = self.keychain.load() {
            let _ = self.post("/api/v1/auth/logout", json!({ "refreshToken": rt })).await;
        }
        self.keychain.clear().map_err(|_| keychain_err())
    }

    #[cfg(test)]
    pub async fn request(&self, method: &str, path: &str, body: Option<Value>) -> Result<ApiResponse, BridgeError> {
        self.request_if(method, path, body, None, None).await
    }

    /// `if_match` is the row version the screen last read (AD-18); digits only, so no other header can ride along.
    /// `idem` is the `Idempotency-Key` of a call the server may see twice (Reply); printable ASCII, at most 128 bytes.
    pub async fn request_if(&self, method: &str, path: &str, body: Option<Value>, if_match: Option<u64>, idem: Option<&str>) -> Result<ApiResponse, BridgeError> {
        let method = parse_method(method)?;
        let idem = idem.unwrap_or("");
        if idem.len() > 128 || !idem.bytes().all(|b| (0x21..0x7f).contains(&b)) {
            return Err(err(Kind::BadRequest, "bad idempotency key"));
        }
        if path == HEALTH {
            // The connection monitor pings this while offline; it needs no sign-in and must not carry a token.
            if method != reqwest::Method::GET {
                return Err(err(Kind::BadRequest, "health is read-only"));
            }
            return self.send(&method, path, None, None, None).await;
        }
        check_path(path)?;
        let payload = body.as_ref().filter(|b| !b.is_null()).map_or(Payload::Empty, |b| Payload::Json(b, idem));
        let (raw, refreshed) = self.authed(&method, path, &payload, if_match, timeout_for(path, self.cfg.request_timeout)).await?;
        Ok(ApiResponse { status: raw.status, body: serde_json::from_slice(&raw.bytes).ok(), refreshed })
    }

    /// Signed call with raw bytes in and out, for uploads and thumbnails. Same token refresh and expiry rules as `request_if`.
    pub async fn call(&self, method: reqwest::Method, path: &str, payload: Payload<'_>, timeout: std::time::Duration) -> Result<Raw, BridgeError> {
        check_path(path)?;
        Ok(self.authed(&method, path, &payload, None, timeout).await?.0)
    }

    async fn authed(
        &self,
        method: &reqwest::Method,
        path: &str,
        payload: &Payload<'_>,
        if_match: Option<u64>,
        timeout: std::time::Duration,
    ) -> Result<(Raw, bool), BridgeError> {
        let cached = self.state.lock().await.access.clone();
        let mut token = match cached {
            Some(t) => t,
            None => self.refresh(None).await?,
        };
        let first = self.send_raw(method, path, payload, Some(&token), if_match, timeout).await?;
        if first.status != 401 {
            return Ok((first, false));
        }
        token = self.refresh(Some(&token)).await?;
        let second = self.send_raw(method, path, payload, Some(&token), if_match, timeout).await?;
        if second.status == 401 {
            return Err(self.expire().await);
        }
        Ok((second, true))
    }

    /// Single flight: callers that saw the same rejected token share one refresh call.
    async fn refresh(&self, rejected: Option<&str>) -> Result<String, BridgeError> {
        let _gate = self.refresh_gate.lock().await;
        let cached = self.state.lock().await.access.clone();
        if let Some(cur) = cached.filter(|c| Some(c.as_str()) != rejected) {
            return Ok(cur);
        }
        let rt = self
            .keychain
            .load()
            .map_err(|_| keychain_err())?
            .ok_or_else(|| err(Kind::SignedOut, "signed out"))?;
        let (status, body) = self.post("/api/v1/auth/refresh", json!({ "refreshToken": rt })).await?;
        match status {
            200 => self.accept(parse_pair(body)?).await,
            401 => Err(self.expire().await),
            403 => {
                self.expire().await;
                Err(err(Kind::NoAccess, "no access"))
            }
            _ => Err(failed("refresh failed")),
        }
    }

    /// Refresh token first: if the keychain refuses it, no access token is kept (fail closed).
    async fn accept(&self, pair: TokenPair) -> Result<String, BridgeError> {
        self.keychain.store(&pair.refresh_token).map_err(|_| keychain_err())?;
        self.state.lock().await.access = Some(pair.access_token.clone());
        Ok(pair.access_token)
    }

    async fn expire(&self) -> BridgeError {
        self.state.lock().await.access = None;
        let _ = self.keychain.clear();
        err(Kind::SessionExpired, "session expired")
    }

    async fn post(&self, path: &str, body: Value) -> Result<(u16, Option<Value>), BridgeError> {
        let r = self.send(&reqwest::Method::POST, path, Some(&body), None, None).await?;
        Ok((r.status, r.body))
    }

    async fn send(
        &self,
        method: &reqwest::Method,
        path: &str,
        body: Option<&Value>,
        bearer: Option<&str>,
        if_match: Option<u64>,
    ) -> Result<ApiResponse, BridgeError> {
        let payload = body.filter(|b| !b.is_null()).map_or(Payload::Empty, |b| Payload::Json(b, ""));
        let raw = self.send_raw(method, path, &payload, bearer, if_match, timeout_for(path, self.cfg.request_timeout)).await?;
        Ok(ApiResponse { status: raw.status, body: serde_json::from_slice(&raw.bytes).ok(), refreshed: false })
    }

    async fn send_raw(
        &self,
        method: &reqwest::Method,
        path: &str,
        payload: &Payload<'_>,
        bearer: Option<&str>,
        if_match: Option<u64>,
        timeout: std::time::Duration,
    ) -> Result<Raw, BridgeError> {
        let mut req = self.http.request(method.clone(), format!("{}{}", self.cfg.api, path)).timeout(timeout);
        if let Some(t) = bearer {
            req = req.bearer_auth(t);
        }
        if let Some(v) = if_match {
            req = req.header("If-Match", v.to_string());
        }
        req = match payload {
            Payload::Empty => req,
            Payload::Json(b, key) => (if key.is_empty() { req } else { req.header("Idempotency-Key", *key) }).json(b),
            Payload::File { name, bytes, key } => {
                let part = reqwest::multipart::Part::bytes(bytes.to_vec()).file_name((*name).to_owned());
                let req = if key.is_empty() { req } else { req.header("Idempotency-Key", *key) };
                req.multipart(reqwest::multipart::Form::new().part("file", part))
            }
        };
        let net = |e: reqwest::Error| {
            if e.is_timeout() {
                err(Kind::Timeout, "request timed out")
            } else if e.is_connect() || e.is_request() {
                err(Kind::Offline, "server unreachable")
            } else {
                failed("request failed")
            }
        };
        let resp = req.send().await.map_err(net)?;
        let status = resp.status().as_u16();
        let bytes = resp.bytes().await.map_err(net)?.to_vec();
        Ok(Raw { status, bytes })
    }
}

fn parse_pair(body: Option<Value>) -> Result<TokenPair, BridgeError> {
    body.and_then(|b| serde_json::from_value(b).ok()).ok_or_else(|| failed("bad token response"))
}

#[cfg(test)]
mod timeout_tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn only_the_provider_calls_get_the_long_timeout() {
        let d = Duration::from_secs(10);
        assert_eq!(timeout_for("/api/v1/admin/ai/test", d), SLOW_TIMEOUT);
        assert_eq!(timeout_for("/api/v1/admin/ai/models", d), SLOW_TIMEOUT);
        assert_eq!(timeout_for("/api/v1/admin/ai", d), d);
        assert_eq!(timeout_for("/api/v1/me", d), d);
    }
}
