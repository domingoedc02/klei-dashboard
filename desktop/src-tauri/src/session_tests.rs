use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use url::Url;

use crate::config::Config;
use crate::error::Kind;
use crate::keychain::{Keychain, MemoryKeychain};
use crate::session::Session;

#[derive(Clone, Debug)]
pub(crate) struct Req {
    pub method: String,
    pub path: String,
    pub auth: String,
    pub if_match: String,
    pub idem: String,
    pub body: Value,
    pub raw: Vec<u8>,
}

pub(crate) type Log = Arc<Mutex<Vec<Req>>>;

pub(crate) fn count(log: &Log, path: &str) -> usize {
    log.lock().unwrap().iter().filter(|r| r.path == path).count()
}

/// A scripted backend on a random local port; `handler` sees each request and the 1-based count of that path.
/// Status 0 stores the request, then closes the connection without an answer; status 1 holds the answer for a second.
pub(crate) async fn mock(handler: impl Fn(&Req, usize) -> (u16, Value) + Send + Sync + 'static) -> (String, Log) {
    mock_bytes(move |r, n| {
        let (status, out) = handler(r, n);
        (status, out.to_string().into_bytes())
    })
    .await
}

/// Same scripted backend, with the answer body as raw bytes (photos).
pub(crate) async fn mock_bytes(handler: impl Fn(&Req, usize) -> (u16, Vec<u8>) + Send + Sync + 'static) -> (String, Log) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let log: Log = Arc::default();
    let (seen, handler) = (log.clone(), Arc::new(handler));
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            let (seen, handler) = (seen.clone(), handler.clone());
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                let (head_end, len) = loop {
                    let n = sock.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&buf[..p]).to_lowercase();
                        let len = head
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse().unwrap_or(0)))
                            .unwrap_or(0usize);
                        break (p + 4, len);
                    }
                };
                while buf.len() < head_end + len {
                    let n = sock.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
                let mut first = head.lines().next().unwrap().split(' ');
                let (method, path) = (first.next().unwrap().to_owned(), first.next().unwrap().to_owned());
                let auth = head
                    .lines()
                    .find_map(|l| l.to_lowercase().starts_with("authorization:").then(|| l[14..].trim().to_owned()))
                    .unwrap_or_default();
                let if_match = head
                    .lines()
                    .find_map(|l| l.to_lowercase().starts_with("if-match:").then(|| l[9..].trim().to_owned()))
                    .unwrap_or_default();
                let idem = head
                    .lines()
                    .find_map(|l| l.to_lowercase().starts_with("idempotency-key:").then(|| l[16..].trim().to_owned()))
                    .unwrap_or_default();
                let raw = buf[head_end..head_end + len].to_vec();
                let body = serde_json::from_slice(&raw).unwrap_or(Value::Null);
                let req = Req { method, path: path.clone(), auth, if_match, idem, body, raw };
                let n = {
                    let mut l = seen.lock().unwrap();
                    l.push(req.clone());
                    l.iter().filter(|r| r.path == path).count()
                };
                let (status, out) = handler(&req, n);
                if status == 0 {
                    return;
                }
                if status == 1 {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                let status = if status == 1 { 200 } else { status };
                let mut reply = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    out.len()
                )
                .into_bytes();
                reply.extend_from_slice(&out);
                let _ = sock.write_all(&reply).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    (base, log)
}

pub(crate) fn pair(access: &str, refresh: &str) -> Value {
    json!({ "accessToken": access, "refreshToken": refresh, "expiresIn": 900 })
}

pub(crate) fn cfg(api: &str, loopback: bool, open: crate::config::Opener) -> Config {
    Config {
        api: api.to_owned(),
        auth: "http://127.0.0.1:1".to_owned(),
        sign_in_timeout: Duration::from_secs(5),
        request_timeout: Duration::from_secs(5),
        upload_timeout: Duration::from_secs(5),
        retry_delay: Duration::from_millis(50),
        loopback,
        smoke: false,
        open,
    }
}

pub(crate) fn session(api: &str, keychain: Arc<dyn Keychain>) -> Arc<Session> {
    Arc::new(Session::new(cfg(api, false, Arc::new(|_| {})), keychain))
}

/// Starts sign-in with the loopback redirect and hands back the authorize URL parts the browser would receive.
async fn start_loopback(
    api: &str,
    keychain: Arc<dyn Keychain>,
) -> (tokio::task::JoinHandle<Result<(), crate::error::BridgeError>>, Url) {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let open: crate::config::Opener = Arc::new(move |u| {
        let _ = tx.send(u.to_owned());
    });
    let s = Arc::new(Session::new(cfg(api, true, open), keychain));
    let task = tokio::spawn(async move { s.sign_in().await });
    (task, Url::parse(&rx.recv().await.unwrap()).unwrap())
}

fn param(u: &Url, k: &str) -> String {
    u.query_pairs().find(|(n, _)| n == k).unwrap().1.into_owned()
}

#[tokio::test]
async fn loopback_sign_in_exchanges_code_and_stores_only_the_refresh_token() {
    let (api, log) = mock(|r, _| match r.path.as_str() {
        "/api/v1/auth/token" => (200, pair("access-1", "refresh-1")),
        _ => (404, json!({})),
    })
    .await;
    let keychain = Arc::new(MemoryKeychain::default());
    let (task, authorize) = start_loopback(&api, keychain.clone()).await;

    assert_eq!(param(&authorize, "client"), "desktop");
    assert_eq!(param(&authorize, "challenge").len(), 43);
    let redirect = param(&authorize, "redirect");
    assert!(redirect.starts_with("http://127.0.0.1:"), "{redirect}");
    let reply = reqwest::get(format!("{redirect}?code=abc&state={}", param(&authorize, "state"))).await.unwrap();
    assert_eq!(reply.status(), 200);

    task.await.unwrap().unwrap();
    assert_eq!(keychain.load().unwrap().as_deref(), Some("refresh-1"));
    let exchange = log.lock().unwrap()[0].clone();
    assert_eq!(exchange.body["code"], "abc");
    assert_eq!(crate::pkce::challenge_for(exchange.body["verifier"].as_str().unwrap()), param(&authorize, "challenge"));
    assert!(reqwest::get(&redirect).await.is_err(), "loopback must close after one request");
}

#[tokio::test]
async fn wrong_state_is_refused_without_calling_the_backend() {
    let (api, log) = mock(|_, _| (200, pair("a", "r"))).await;
    let keychain = Arc::new(MemoryKeychain::default());
    let (task, authorize) = start_loopback(&api, keychain.clone()).await;
    reqwest::get(format!("{}?code=abc&state=not-the-state", param(&authorize, "redirect"))).await.unwrap();

    assert_eq!(task.await.unwrap().unwrap_err().kind, Kind::Failed);
    assert!(log.lock().unwrap().is_empty());
    assert_eq!(keychain.load().unwrap(), None);
}

#[tokio::test]
async fn rejected_code_stores_nothing() {
    let (api, _) = mock(|_, _| (400, json!({ "code": "bad_request" }))).await;
    let keychain = Arc::new(MemoryKeychain::default());
    let (task, authorize) = start_loopback(&api, keychain.clone()).await;
    let state = param(&authorize, "state");
    reqwest::get(format!("{}?code=old&state={state}", param(&authorize, "redirect"))).await.unwrap();

    assert_eq!(task.await.unwrap().unwrap_err().kind, Kind::Failed);
    assert_eq!(keychain.load().unwrap(), None);
}

#[tokio::test]
async fn deep_link_callback_completes_sign_in() {
    let (api, _) = mock(|_, _| (200, pair("access-1", "refresh-1"))).await;
    let keychain = Arc::new(MemoryKeychain::default());
    let (tx, mut rx) = mpsc::unbounded_channel();
    let open: crate::config::Opener = Arc::new(move |u| {
        let _ = tx.send(u.to_owned());
    });
    let s = Arc::new(Session::new(cfg(&api, false, open), keychain.clone()));
    let waiting = { let s = s.clone(); tokio::spawn(async move { s.sign_in().await }) };
    let authorize = Url::parse(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(param(&authorize, "redirect"), "klei://auth/callback");

    let cb = Url::parse(&format!("klei://auth/callback?code=abc&state={}", param(&authorize, "state"))).unwrap();
    s.complete(&cb).await.unwrap();
    waiting.await.unwrap().unwrap();
    assert_eq!(keychain.load().unwrap().as_deref(), Some("refresh-1"));
}

#[tokio::test]
async fn sign_in_times_out() {
    let (api, _) = mock(|_, _| (200, json!({}))).await;
    let mut c = cfg(&api, false, Arc::new(|_| {}));
    c.sign_in_timeout = Duration::from_millis(100);
    let s = Arc::new(Session::new(c, Arc::new(MemoryKeychain::default())));
    assert_eq!(s.sign_in().await.unwrap_err().kind, Kind::Timeout);
}

#[tokio::test]
async fn unusable_keychain_fails_closed() {
    let (api, log) = mock(|_, _| (200, pair("a", "r"))).await;
    let s = session(&api, Arc::new(MemoryKeychain::broken()));
    assert_eq!(s.sign_in().await.unwrap_err().kind, Kind::KeychainUnavailable);
    assert_eq!(s.request("GET", "/api/v1/me", None).await.unwrap_err().kind, Kind::KeychainUnavailable);
    assert!(log.lock().unwrap().is_empty());
}

#[tokio::test]
async fn concurrent_requests_share_one_refresh() {
    let (api, log) = mock(|r, _| match r.path.as_str() {
        "/api/v1/auth/refresh" => (200, pair("access-1", "refresh-1")),
        "/api/v1/me" if r.auth == "Bearer access-1" => (200, json!({ "name": "Ada" })),
        _ => (401, json!({ "code": "unauthenticated" })),
    })
    .await;
    let keychain = Arc::new(MemoryKeychain::default());
    keychain.store("refresh-0").unwrap();
    let s = session(&api, keychain.clone());
    let calls: Vec<_> = (0..5)
        .map(|_| { let s = s.clone(); tokio::spawn(async move { s.request("GET", "/api/v1/me", None).await }) })
        .collect();
    for c in calls {
        let r = c.await.unwrap().unwrap();
        assert_eq!((r.status, r.body.unwrap()["name"].clone()), (200, json!("Ada")));
    }
    assert_eq!(count(&log, "/api/v1/auth/refresh"), 1);
    assert_eq!(keychain.load().unwrap().as_deref(), Some("refresh-1"));
}

#[tokio::test]
async fn if_match_rides_the_request_and_only_that_one() {
    let (api, log) = mock(|r, n| match (r.path.as_str(), n) {
        ("/api/v1/auth/refresh", _) => (200, pair("access-2", "refresh-2")),
        ("/api/v1/admin/users/x", _) if r.auth == "Bearer access-2" => (200, json!({})),
        _ => (401, json!({ "code": "token_stale" })),
    })
    .await;
    let keychain = Arc::new(MemoryKeychain::default());
    keychain.store("refresh-0").unwrap();
    let s = session(&api, keychain);
    assert_eq!(s.request_if("PATCH", "/api/v1/admin/users/x", Some(json!({ "name": "A" })), Some(7), None).await.unwrap().status, 200);
    let sent: Vec<String> = log.lock().unwrap().iter().filter(|r| r.path == "/api/v1/admin/users/x").map(|r| r.if_match.clone()).collect();
    assert_eq!(sent, ["7"]);
    assert_eq!(s.request("GET", "/api/v1/admin/users/x", None).await.unwrap().status, 200);
    assert!(log.lock().unwrap().last().unwrap().if_match.is_empty());
}

#[tokio::test]
async fn idempotency_key_rides_a_json_call_and_only_a_clean_one() {
    let (api, log) = mock(|r, n| match (r.path.as_str(), n) {
        ("/api/v1/auth/refresh", _) => (200, pair("access-2", "refresh-2")),
        ("/api/v1/inquiries/x/reply", _) if r.auth == "Bearer access-2" => (201, json!({})),
        _ => (401, json!({ "code": "token_stale" })),
    })
    .await;
    let keychain = Arc::new(MemoryKeychain::default());
    keychain.store("refresh-0").unwrap();
    let s = session(&api, keychain);
    let body = || Some(json!({ "body": "<div>x</div>" }));
    assert_eq!(s.request_if("POST", "/api/v1/inquiries/x/reply", body(), None, Some("abc-123")).await.unwrap().status, 201);
    assert_eq!(s.request_if("POST", "/api/v1/inquiries/x/reply", body(), None, None).await.unwrap().status, 201);
    let sent: Vec<String> = log.lock().unwrap().iter().filter(|r| r.path == "/api/v1/inquiries/x/reply").map(|r| r.idem.clone()).collect();
    assert_eq!(sent, ["abc-123", ""]);
    for bad in ["a b", "a\r\nX: y", &"k".repeat(129)] {
        assert!(s.request_if("POST", "/api/v1/inquiries/x/reply", body(), None, Some(bad)).await.is_err(), "{bad:?}");
    }
}

#[tokio::test]
async fn stale_token_refreshes_once_and_retries_once() {
    let (api, log) = mock(|r, n| match (r.path.as_str(), n) {
        ("/api/v1/auth/refresh", 1) => (200, pair("access-1", "refresh-1")),
        ("/api/v1/auth/refresh", _) => (200, pair("access-2", "refresh-2")),
        ("/api/v1/me", _) if r.auth == "Bearer access-2" => (200, json!({ "ok": true })),
        _ => (401, json!({ "code": "token_stale" })),
    })
    .await;
    let keychain = Arc::new(MemoryKeychain::default());
    keychain.store("refresh-0").unwrap();
    let s = session(&api, keychain.clone());
    let first = s.request("GET", "/api/v1/me", None).await.unwrap();
    assert!(first.status == 200 && first.refreshed);
    assert_eq!(count(&log, "/api/v1/auth/refresh"), 2);
    assert_eq!(count(&log, "/api/v1/me"), 2);
    assert_eq!(keychain.load().unwrap().as_deref(), Some("refresh-2"));
    assert!(!s.request("GET", "/api/v1/me", None).await.unwrap().refreshed);
}

#[tokio::test]
async fn refused_refresh_ends_the_session_and_clears_the_keychain() {
    let (api, _) = mock(|_, _| (401, json!({ "code": "unauthenticated" }))).await;
    let keychain = Arc::new(MemoryKeychain::default());
    keychain.store("refresh-0").unwrap();
    let s = session(&api, keychain.clone());
    assert_eq!(s.request("GET", "/api/v1/me", None).await.unwrap_err().kind, Kind::SessionExpired);
    assert_eq!(keychain.load().unwrap(), None);
    assert_eq!(s.request("GET", "/api/v1/me", None).await.unwrap_err().kind, Kind::SignedOut);
}

#[tokio::test]
async fn refresh_refused_for_a_role_without_permissions_reports_no_access() {
    let (api, _) = mock(|r, _| if r.path == "/api/v1/auth/refresh" { (403, json!({ "code": "forbidden" })) } else { (401, json!({ "code": "token_stale" })) }).await;
    let keychain = Arc::new(MemoryKeychain::default());
    keychain.store("refresh-0").unwrap();
    let s = session(&api, keychain.clone());
    assert_eq!(s.request("GET", "/api/v1/me", None).await.unwrap_err().kind, Kind::NoAccess);
    assert_eq!(keychain.load().unwrap(), None);
}

#[tokio::test]
async fn sign_out_revokes_on_the_server_and_empties_the_keychain() {
    let (api, log) = mock(|_, _| (204, Value::Null)).await;
    let keychain = Arc::new(MemoryKeychain::default());
    keychain.store("refresh-0").unwrap();
    let s = session(&api, keychain.clone());
    s.sign_out().await.unwrap();
    assert_eq!(keychain.load().unwrap(), None);
    let sent = log.lock().unwrap()[0].clone();
    assert_eq!((sent.method.as_str(), sent.path.as_str()), ("POST", "/api/v1/auth/logout"));
    assert_eq!(sent.body["refreshToken"], "refresh-0");
}

#[tokio::test]
async fn sign_out_works_offline() {
    let keychain = Arc::new(MemoryKeychain::default());
    keychain.store("refresh-0").unwrap();
    let s = session("http://127.0.0.1:1", keychain.clone());
    s.sign_out().await.unwrap();
    assert_eq!(keychain.load().unwrap(), None);
}

#[tokio::test]
async fn requests_stay_under_the_api_prefix() {
    let (api, log) = mock(|_, _| (200, json!({}))).await;
    let s = session(&api, Arc::new(MemoryKeychain::default()));
    for p in ["/me", "/api/v1/../x", "//evil.test/api/v1/x", "/api/v1/a b", "http://evil.test/api/v1/x", "/api/v1/a\\b"] {
        assert_eq!(s.request("GET", p, None).await.unwrap_err().kind, Kind::BadRequest, "{p}");
    }
    assert_eq!(s.request("TRACE", "/api/v1/me", None).await.unwrap_err().kind, Kind::BadRequest);
    assert!(log.lock().unwrap().is_empty());
}

#[tokio::test]
async fn unreachable_server_reports_offline() {
    let keychain = Arc::new(MemoryKeychain::default());
    keychain.store("refresh-0").unwrap();
    let s = session("http://127.0.0.1:1", keychain);
    assert_eq!(s.request("GET", "/api/v1/me", None).await.unwrap_err().kind, Kind::Offline);
}

#[tokio::test]
async fn health_ping_needs_no_sign_in_and_sends_no_token() {
    let (api, log) = mock(|_, _| (503, json!({}))).await;
    let s = session(&api, Arc::new(MemoryKeychain::default()));
    assert_eq!(s.request("GET", "/health/ready", None).await.unwrap().status, 503);
    assert_eq!(log.lock().unwrap()[0].auth, "");
    for (m, p) in [("POST", "/health/ready"), ("GET", "/health"), ("GET", "/health/ready/x")] {
        assert_eq!(s.request(m, p, None).await.unwrap_err().kind, Kind::BadRequest, "{m} {p}");
    }
    assert_eq!(log.lock().unwrap().len(), 1);
}

#[test]
fn dirty_flag_round_trips() {
    let s = Session::new(cfg("http://127.0.0.1:1", false, Arc::new(|_| {})), Arc::new(MemoryKeychain::default()));
    assert!(!s.is_dirty());
    s.set_dirty(true);
    assert!(s.is_dirty());
    s.set_dirty(false);
    assert!(!s.is_dirty());
}
