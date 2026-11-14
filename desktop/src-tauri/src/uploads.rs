//! Sends the photos the User picked or dropped to their upload batch (Story 4.2, AD-10).
//! The one module that touches the file system, and only to read: no copy, cache or temp file is written (NFR-1).

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tokio::sync::watch;

use crate::error::{BridgeError, Kind};
use crate::session::{Payload, Session};

pub const MAX_BYTES: u64 = 25 * 1024 * 1024;
pub const EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];
const IN_FLIGHT: usize = 3;

/// Why a file was not stored. The webview owns the wording.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    Type,
    Size,
    Full,
    Dimensions,
    Unreadable,
}

#[derive(Clone, Debug, Serialize)]
pub struct Rejected {
    pub name: String,
    pub reason: Reason,
}

#[derive(Default, Debug, Serialize)]
pub struct Summary {
    pub stored: Vec<String>,
    pub rejected: Vec<Rejected>,
    pub cancelled: bool,
}

/// `done` counts files the server has answered; `waiting` is true while any file waits for the connection.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: usize,
    pub total: usize,
    pub waiting: bool,
    pub photo_id: Option<String>,
}

/// What the shell tells the Upload screen over the channel the screen handed in. Paths never leave Rust.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Progress(Progress),
    /// Files are being dragged over (or left) the window.
    Drag { over: bool },
    /// Files were dropped; `uploadFiles('dropped')` sends them.
    Dropped { count: usize },
}

/// Run state shared by the commands: at most one run, the screen listening for drops, and the paths of the last OS drop.
/// Dropped paths are kept here, never taken from the webview, so only files the User really dropped can be sent.
#[derive(Default)]
pub struct Uploader {
    active: Mutex<Option<watch::Sender<bool>>>,
    dropped: Mutex<Option<(Instant, Vec<PathBuf>)>>,
    watcher: Mutex<Option<Channel<Event>>>,
}

/// A drop is claimed within this long or forgotten.
const DROP_TTL: Duration = Duration::from_secs(10);

pub struct Active<'a>(&'a Uploader);

impl Drop for Active<'_> {
    fn drop(&mut self) {
        self.0.active.lock().unwrap().take();
    }
}

impl Uploader {
    /// Only the Upload screen listens; a drop anywhere else is forgotten at once.
    pub fn watch(&self, channel: Channel<Event>) {
        *self.watcher.lock().unwrap() = Some(channel);
    }

    pub fn unwatch(&self) {
        self.watcher.lock().unwrap().take();
        self.dropped.lock().unwrap().take();
    }

    pub fn drag(&self, over: bool) {
        if let Some(w) = self.watcher.lock().unwrap().as_ref() {
            let _ = w.send(Event::Drag { over });
        }
    }

    pub fn drop_files(&self, paths: Vec<PathBuf>) {
        let watcher = self.watcher.lock().unwrap();
        let Some(w) = watcher.as_ref() else { return };
        let count = paths.len();
        *self.dropped.lock().unwrap() = Some((Instant::now(), paths));
        let _ = w.send(Event::Dropped { count });
    }

    pub fn take_drop(&self) -> Vec<PathBuf> {
        match self.dropped.lock().unwrap().take() {
            Some((at, paths)) if at.elapsed() < DROP_TTL => paths,
            _ => Vec::new(),
        }
    }

    /// Claims the single run slot; the receiver sees `true` once [`Uploader::cancel`] is called.
    pub fn begin(&self) -> Result<(Active<'_>, watch::Receiver<bool>), BridgeError> {
        let mut active = self.active.lock().unwrap();
        if active.is_some() {
            return Err(BridgeError::new(Kind::BadRequest, "an upload is already running"));
        }
        let (tx, rx) = watch::channel(false);
        *active = Some(tx);
        Ok((Active(self), rx))
    }

    pub fn cancel(&self) {
        if let Some(tx) = self.active.lock().unwrap().as_ref() {
            let _ = tx.send(true);
        }
    }
}

pub type Emit = Arc<dyn Fn(Progress) + Send + Sync>;

#[derive(Clone, Debug)]
pub struct Picked {
    pub path: PathBuf,
    pub len: u64,
    pub mtime: u128,
}

fn base_name(p: &std::path::Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Reads size and modified time only. Folders are skipped; a file that cannot be inspected is refused.
pub fn stat(paths: Vec<PathBuf>) -> (Vec<Picked>, Vec<Rejected>) {
    let (mut ok, mut bad) = (Vec::new(), Vec::new());
    for path in paths {
        match std::fs::metadata(&path) {
            Ok(m) if m.is_dir() => {}
            Ok(m) => {
                let mtime = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
                ok.push(Picked { path, len: m.len(), mtime });
            }
            Err(_) => bad.push(Rejected { name: base_name(&path), reason: Reason::Unreadable }),
        }
    }
    (ok, bad)
}

/// Filters by extension and size. The batch ceiling is the server's call (a 413 with `limit`), which also confirms the real image type.
pub fn triage(picked: Vec<Picked>) -> (Vec<Picked>, Vec<Rejected>) {
    let (mut send, mut refused) = (Vec::new(), Vec::new());
    for p in picked {
        let ext_ok = p.path.extension().and_then(|e| e.to_str()).is_some_and(|e| EXTENSIONS.iter().any(|x| x.eq_ignore_ascii_case(e)));
        let reason = if !ext_ok {
            Some(Reason::Type)
        } else if p.len > MAX_BYTES {
            Some(Reason::Size)
        } else {
            None
        };
        match reason {
            Some(reason) => refused.push(Rejected { name: base_name(&p.path), reason }),
            None => send.push(p),
        }
    }
    (send, refused)
}

/// Same file in the same batch gives the same key, so a resend after a lost answer, or after a restart, stores nothing twice.
fn key_for(batch: &str, p: &Picked) -> String {
    let mut h = Sha256::new();
    for part in [batch, &p.path.to_string_lossy(), &p.len.to_string(), &p.mtime.to_string()] {
        h.update(part.as_bytes());
        h.update([0]);
    }
    h.finalize()[..16].iter().map(|b| format!("{b:02x}")).collect()
}

enum Outcome {
    Stored(String),
    Refused(Reason),
    Cancelled,
    Fatal(BridgeError),
}

pub(crate) async fn cancelled(mut rx: watch::Receiver<bool>) {
    // A dropped sender means nobody can cancel any more, which is not a cancel.
    if rx.wait_for(|c| *c).await.is_err() {
        std::future::pending::<()>().await;
    }
}

struct Run {
    session: Arc<Session>,
    batch: String,
    cancel: watch::Receiver<bool>,
    emit: Emit,
    queue: Mutex<VecDeque<Picked>>,
    out: Mutex<Summary>,
    fatal: Mutex<Option<BridgeError>>,
    total: usize,
    done: AtomicUsize,
    waiting: AtomicUsize,
    full: AtomicBool,
}

impl Run {
    fn tick(&self, photo_id: Option<String>) {
        (self.emit)(Progress {
            done: self.done.load(Ordering::SeqCst),
            total: self.total,
            waiting: self.waiting.load(Ordering::SeqCst) > 0,
            photo_id,
        });
    }

    async fn worker(self: Arc<Self>) {
        while !*self.cancel.borrow() {
            let Some(job) = self.queue.lock().unwrap().pop_front() else { return };
            match self.one(&job).await {
                Outcome::Stored(id) => {
                    self.out.lock().unwrap().stored.push(id.clone());
                    self.done.fetch_add(1, Ordering::SeqCst);
                    self.tick(Some(id));
                }
                Outcome::Refused(reason) => {
                    self.out.lock().unwrap().rejected.push(Rejected { name: base_name(&job.path), reason });
                    self.done.fetch_add(1, Ordering::SeqCst);
                    self.tick(None);
                }
                Outcome::Cancelled => return,
                Outcome::Fatal(e) => {
                    self.fatal.lock().unwrap().get_or_insert(e);
                    self.queue.lock().unwrap().clear();
                    return;
                }
            }
        }
    }

    /// Sends one file until the server answers. A lost connection or a busy server waits and re-sends with the same key.
    async fn one(&self, job: &Picked) -> Outcome {
        if self.full.load(Ordering::SeqCst) {
            return Outcome::Refused(Reason::Full);
        }
        let path = job.path.clone();
        let Ok(Ok(bytes)) = tokio::task::spawn_blocking(move || std::fs::read(path)).await else {
            return Outcome::Refused(Reason::Unreadable);
        };
        let (name, key) = (base_name(&job.path), key_for(&self.batch, job));
        let url = format!("/api/v1/uploads/{}/photos", self.batch);
        let cfg = self.session.config();
        loop {
            let send = self.session.call(reqwest::Method::POST, &url, Payload::File { name: &name, bytes: &bytes, key: &key }, cfg.upload_timeout);
            let sent = tokio::select! {
                r = send => r,
                () = cancelled(self.cancel.clone()) => return Outcome::Cancelled,
            };
            match sent {
                Ok(raw) => match raw.status {
                    200 | 201 => {
                        let id = serde_json::from_slice::<Value>(&raw.bytes).ok().and_then(|v| v["id"].as_str().map(str::to_owned));
                        return id.map_or_else(|| Outcome::Fatal(BridgeError::new(Kind::Failed, "bad upload answer")), Outcome::Stored);
                    }
                    413 => {
                        let limit = serde_json::from_slice::<Value>(&raw.bytes).ok().is_some_and(|v| v["extensions"]["limit"].is_number());
                        if limit {
                            self.full.store(true, Ordering::SeqCst);
                        }
                        return Outcome::Refused(if limit { Reason::Full } else { Reason::Dimensions });
                    }
                    415 => return Outcome::Refused(Reason::Type),
                    403 => return Outcome::Fatal(BridgeError::new(Kind::NoAccess, "no access")),
                    429 | 502 | 503 | 504 => {}
                    _ => return Outcome::Fatal(BridgeError::new(Kind::Failed, "upload failed")),
                },
                Err(e) if matches!(e.kind, Kind::Offline | Kind::Timeout) => {}
                Err(e) => return Outcome::Fatal(e),
            }
            self.waiting.fetch_add(1, Ordering::SeqCst);
            self.tick(None);
            let slept = tokio::select! {
                () = tokio::time::sleep(cfg.retry_delay) => true,
                () = cancelled(self.cancel.clone()) => false,
            };
            self.waiting.fetch_sub(1, Ordering::SeqCst);
            if !slept {
                return Outcome::Cancelled;
            }
        }
    }
}

/// Uploads `paths` into `batch`. The batch must be the caller's own; the room left in it comes from the server.
/// Stored files stay stored whatever happens later. A cancel stops the queue and abandons requests in flight; their keys make a later resend safe.
pub async fn run(
    session: Arc<Session>,
    batch: String,
    paths: Vec<PathBuf>,
    cancel: watch::Receiver<bool>,
    emit: Emit,
) -> Result<Summary, BridgeError> {
    let timeout = session.config().request_timeout;
    let cur = session.call(reqwest::Method::GET, "/api/v1/uploads/current", Payload::Empty, timeout).await?;
    let view = match cur.status {
        200 => serde_json::from_slice::<Value>(&cur.bytes).ok(),
        403 => return Err(BridgeError::new(Kind::NoAccess, "no access")),
        _ => None,
    };
    let view = view.ok_or_else(|| BridgeError::new(Kind::Failed, "no upload batch"))?;
    if view["id"].as_str() != Some(batch.as_str()) {
        return Err(BridgeError::new(Kind::BadRequest, "not the current batch"));
    }

    let (picked, mut refused) = tokio::task::spawn_blocking(move || stat(paths))
        .await
        .map_err(|_| BridgeError::new(Kind::Failed, "could not read the files"))?;
    let (queue, over) = triage(picked);
    refused.extend(over);

    let run = Arc::new(Run {
        session,
        batch,
        cancel: cancel.clone(),
        emit,
        total: queue.len(),
        queue: Mutex::new(queue.into()),
        out: Mutex::new(Summary::default()),
        fatal: Mutex::default(),
        done: AtomicUsize::new(0),
        waiting: AtomicUsize::new(0),
        full: AtomicBool::new(false),
    });
    run.tick(None);
    let workers: Vec<_> = (0..IN_FLIGHT).map(|_| tokio::spawn(run.clone().worker())).collect();
    for w in workers {
        let _ = w.await;
    }
    if let Some(e) = run.fatal.lock().unwrap().take() {
        return Err(e);
    }
    let mut out = std::mem::take(&mut *run.out.lock().unwrap());
    refused.append(&mut out.rejected);
    out.rejected = refused;
    out.cancelled = *cancel.borrow();
    Ok(out)
}

pub const AVATAR_MAX_BYTES: u64 = 2 * 1024 * 1024;

/// Sends one picked file as the signed-in User's avatar (Story 6.1). `stored` holds "avatar" on success; the server confirms the real type.
pub async fn set_avatar(session: &Session, path: PathBuf) -> Result<Summary, BridgeError> {
    let (picked, mut refused) = stat(vec![path]);
    let (send, more) = triage(picked);
    refused.extend(more);
    let mut out = Summary::default();
    if let Some(p) = send.into_iter().next() {
        let name = base_name(&p.path);
        let path = p.path.clone();
        let reason = if p.len > AVATAR_MAX_BYTES {
            Some(Reason::Size)
        } else if let Ok(Ok(bytes)) = tokio::task::spawn_blocking(move || std::fs::read(path)).await {
            let cfg = session.config();
            let raw = session.call(reqwest::Method::PUT, "/api/v1/me/avatar", Payload::File { name: &name, bytes: &bytes, key: "" }, cfg.upload_timeout).await?;
            match raw.status {
                200 | 201 => None,
                413 => Some(Reason::Size),
                415 => Some(Reason::Type),
                403 => return Err(BridgeError::new(Kind::NoAccess, "no access")),
                _ => return Err(BridgeError::new(Kind::Failed, "avatar upload failed")),
            }
        } else {
            Some(Reason::Unreadable)
        };
        match reason {
            None => out.stored.push("avatar".to_owned()),
            Some(reason) => refused.push(Rejected { name, reason }),
        }
    }
    out.rejected = refused;
    Ok(out)
}

/// A Reply carries at most 20 MB in all (Story 7.3); one file above that is refused before it is read.
pub const ATTACHMENT_MAX_BYTES: u64 = 20 * 1024 * 1024;

fn fresh_key() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("operating system random source");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Sends the picked files to the Reply of one Inquiry, one at a time, any type. `stored` holds the Attachment ids.
/// shortcut: no resend after a lost connection (the User attaches again), no cancel; add both if files grow past a few MB.
pub async fn attach_files(session: &Session, inquiry: &str, paths: Vec<PathBuf>) -> Result<Summary, BridgeError> {
    if inquiry.len() != 36 || !inquiry.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err(BridgeError::new(Kind::BadRequest, "bad inquiry id"));
    }
    let (picked, mut refused) = stat(paths);
    let mut out = Summary::default();
    let url = format!("/api/v1/inquiries/{inquiry}/attachments");
    let cfg = session.config();
    for p in picked {
        let name = base_name(&p.path);
        if p.len > ATTACHMENT_MAX_BYTES {
            refused.push(Rejected { name, reason: Reason::Size });
            continue;
        }
        let path = p.path.clone();
        let Ok(Ok(bytes)) = tokio::task::spawn_blocking(move || std::fs::read(path)).await else {
            refused.push(Rejected { name, reason: Reason::Unreadable });
            continue;
        };
        let key = fresh_key();
        let raw = session.call(reqwest::Method::POST, &url, Payload::File { name: &name, bytes: &bytes, key: &key }, cfg.upload_timeout).await?;
        match raw.status {
            200 | 201 => match serde_json::from_slice::<Value>(&raw.bytes).ok().and_then(|v| v["id"].as_str().map(str::to_owned)) {
                Some(id) => out.stored.push(id),
                None => return Err(BridgeError::new(Kind::Failed, "bad attachment answer")),
            },
            413 => refused.push(Rejected { name, reason: Reason::Size }),
            422 => refused.push(Rejected { name, reason: Reason::Unreadable }),
            403 => return Err(BridgeError::new(Kind::NoAccess, "no access")),
            _ => return Err(BridgeError::new(Kind::Failed, "attachment upload failed")),
        }
    }
    out.rejected = refused;
    Ok(out)
}

#[cfg(test)]
mod triage_tests {
    use super::*;

    fn pick(name: &str, len: u64) -> Picked {
        Picked { path: PathBuf::from(format!("/photos/{name}")), len, mtime: 0 }
    }

    #[test]
    fn extension_then_size_are_checked_and_the_count_is_not() {
        let (send, refused) = triage(vec![pick("a.JPG", 1), pick("b.gif", 1), pick("c.png", MAX_BYTES + 1), pick("d.webp", MAX_BYTES), pick("e.jpeg", 1)]);
        let sent: Vec<_> = send.iter().map(|p| base_name(&p.path)).collect();
        assert_eq!(sent, ["a.JPG", "d.webp", "e.jpeg"]);
        let why: Vec<_> = refused.iter().map(|r| (r.name.as_str(), r.reason)).collect();
        assert_eq!(why, [("b.gif", Reason::Type), ("c.png", Reason::Size)]);
    }

    #[test]
    fn keys_are_stable_per_file_and_differ_between_files_and_batches() {
        let a = pick("a.jpg", 5);
        assert_eq!(key_for("b1", &a), key_for("b1", &a.clone()));
        assert_ne!(key_for("b1", &a), key_for("b2", &a));
        assert_ne!(key_for("b1", &a), key_for("b1", &pick("b.jpg", 5)));
        assert_eq!(key_for("b1", &a).len(), 32);
    }
}
