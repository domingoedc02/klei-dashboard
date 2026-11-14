use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use crate::error::Kind;
use crate::keychain::{Keychain, MemoryKeychain};
use crate::session::Session;
use crate::session_tests::{cfg, count, mock, pair, Log, Req};
use crate::uploads::{run, Emit, Progress, Reason, Uploader};

const BATCH: &str = "0b1c2d3e-0000-4000-8000-000000000001";
const PHOTOS: &str = "/api/v1/uploads/0b1c2d3e-0000-4000-8000-000000000001/photos";

fn shared(r: &Req, held: &[&str]) -> Option<(u16, Value)> {
    match r.path.as_str() {
        "/api/v1/auth/refresh" => Some((200, pair("access-1", "refresh-1"))),
        "/api/v1/uploads/current" => Some((200, json!({ "id": BATCH, "phase": "empty", "photoIds": held, "rejected": 0 }))),
        _ => None,
    }
}

fn stored(n: usize) -> (u16, Value) {
    (201, json!({ "id": format!("0b1c2d3e-0000-4000-8000-{n:012}") }))
}

fn has(r: &Req, name: &str) -> bool {
    String::from_utf8_lossy(&r.raw).contains(&format!("filename=\"{name}\""))
}

pub(crate) fn signed_in(api: &str, upload_timeout: Duration) -> Arc<Session> {
    let keychain = Arc::new(MemoryKeychain::default());
    keychain.store("refresh-0").unwrap();
    let mut c = cfg(api, false, Arc::new(|_| {}));
    c.upload_timeout = upload_timeout;
    Arc::new(Session::new(c, keychain))
}

struct Folder(PathBuf);

impl Folder {
    fn with(tag: &str, files: &[(&str, usize)]) -> Self {
        let dir = std::env::temp_dir().join(format!("klei-up-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for (name, len) in files {
            std::fs::write(dir.join(name), vec![7u8; *len]).unwrap();
        }
        Self(dir)
    }

    fn paths(&self, names: &[&str]) -> Vec<PathBuf> {
        names.iter().map(|n| self.0.join(n)).collect()
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn collector() -> (Emit, Arc<Mutex<Vec<Progress>>>) {
    let seen: Arc<Mutex<Vec<Progress>>> = Arc::default();
    let sink = seen.clone();
    (Arc::new(move |p| sink.lock().unwrap().push(p)), seen)
}

fn posts(log: &Log) -> Vec<Req> {
    log.lock().unwrap().iter().filter(|r| r.path == PHOTOS).cloned().collect()
}

#[tokio::test]
async fn a_file_goes_as_multipart_part_file_with_bearer_and_key() {
    let (api, log) = mock(|r, _| shared(r, &[]).unwrap_or_else(|| stored(1))).await;
    let dir = Folder::with("one", &[("gown.jpg", 40)]);
    let (emit, seen) = collector();
    let (_a, cancel) = Uploader::default().begin().map(|(a, c)| (std::mem::ManuallyDrop::new(a), c)).unwrap();
    let out = run(signed_in(&api, Duration::from_secs(5)), BATCH.into(), dir.paths(&["gown.jpg"]), cancel, emit).await.unwrap();

    assert_eq!(out.stored.len(), 1);
    assert!(out.rejected.is_empty() && !out.cancelled);
    let sent = posts(&log);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].auth, "Bearer access-1");
    assert_eq!(sent[0].idem.len(), 32);
    assert!(has(&sent[0], "gown.jpg"));
    assert!(String::from_utf8_lossy(&sent[0].raw).contains("name=\"file\""));
    let last = seen.lock().unwrap().last().cloned().unwrap();
    assert_eq!((last.done, last.total, last.waiting), (1, 1, false));
}

#[tokio::test]
async fn a_lost_answer_is_resent_with_the_same_key() {
    let (api, log) = mock(|r, n| {
        shared(r, &[]).unwrap_or_else(|| if n == 1 { (1, json!({})) } else { stored(1) })
    })
    .await;
    let dir = Folder::with("lost", &[("a.png", 10)]);
    let (emit, seen) = collector();
    let (_a, cancel) = Uploader::default().begin().map(|(a, c)| (std::mem::ManuallyDrop::new(a), c)).unwrap();
    let out = run(signed_in(&api, Duration::from_millis(300)), BATCH.into(), dir.paths(&["a.png"]), cancel, emit).await.unwrap();

    assert_eq!(out.stored.len(), 1);
    let sent = posts(&log);
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0].idem, sent[1].idem, "the resend must carry the key of the first try");
    assert!(seen.lock().unwrap().iter().any(|p| p.waiting), "the screen is told it is waiting");
}

#[tokio::test]
async fn a_busy_server_is_waited_for() {
    let (api, log) = mock(|r, n| shared(r, &[]).unwrap_or_else(|| if n == 1 { (503, json!({})) } else { stored(1) })).await;
    let dir = Folder::with("busy", &[("a.webp", 10)]);
    let (emit, _) = collector();
    let (_a, cancel) = Uploader::default().begin().map(|(a, c)| (std::mem::ManuallyDrop::new(a), c)).unwrap();
    let out = run(signed_in(&api, Duration::from_secs(5)), BATCH.into(), dir.paths(&["a.webp"]), cancel, emit).await.unwrap();
    assert_eq!(out.stored.len(), 1);
    assert_eq!(count(&log, PHOTOS), 2);
}

#[tokio::test]
async fn at_most_three_files_are_in_flight() {
    // Status 1 holds every answer for a second, so the requests that have arrived after 300 ms are the ones in flight.
    let (api, log) = mock(|r, n| shared(r, &[]).unwrap_or_else(|| (1, stored(n).1))).await;
    let names = ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "6.jpg", "7.jpg"];
    let dir = Folder::with("three", &names.map(|n| (n, 5)));
    let (emit, _) = collector();
    let (_a, cancel) = Uploader::default().begin().map(|(a, c)| (std::mem::ManuallyDrop::new(a), c)).unwrap();
    let task = tokio::spawn(run(signed_in(&api, Duration::from_secs(5)), BATCH.into(), dir.paths(&names), cancel, emit));
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(count(&log, PHOTOS), 3);
    assert_eq!(task.await.unwrap().unwrap().stored.len(), 7);
}

#[tokio::test]
async fn the_server_refusals_become_reasons_and_the_rest_carry_on() {
    let (api, _) = mock(|r, _| {
        shared(r, &[]).unwrap_or_else(|| {
            if has(r, "fake.png") {
                (415, json!({ "code": "unsupported_type" }))
            } else if has(r, "huge.png") {
                (413, json!({ "code": "too_large" }))
            } else {
                stored(1)
            }
        })
    })
    .await;
    let dir = Folder::with("why", &[("ok.jpg", 5), ("fake.png", 5), ("huge.png", 5), ("note.txt", 5)]);
    let (emit, _) = collector();
    let (_a, cancel) = Uploader::default().begin().map(|(a, c)| (std::mem::ManuallyDrop::new(a), c)).unwrap();
    let out = run(signed_in(&api, Duration::from_secs(5)), BATCH.into(), dir.paths(&["ok.jpg", "fake.png", "huge.png", "note.txt"]), cancel, emit)
        .await
        .unwrap();
    assert_eq!(out.stored.len(), 1);
    let mut why: Vec<_> = out.rejected.iter().map(|r| (r.name.clone(), r.reason)).collect();
    why.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
        why,
        [("fake.png".into(), Reason::Type), ("huge.png".into(), Reason::Dimensions), ("note.txt".into(), Reason::Type)]
    );
}

#[tokio::test]
async fn a_413_with_a_limit_means_the_batch_is_full_and_no_more_are_sent() {
    let (api, log) = mock(|r, _| shared(r, &[]).unwrap_or((413, json!({ "code": "too_large", "extensions": { "limit": 5 } })))).await;
    let names: Vec<String> = (0..8).map(|i| format!("{i}.jpg")).collect();
    let files: Vec<(&str, usize)> = names.iter().map(|n| (n.as_str(), 5)).collect();
    let dir = Folder::with("full", &files);
    let (emit, _) = collector();
    let (_a, cancel) = Uploader::default().begin().map(|(a, c)| (std::mem::ManuallyDrop::new(a), c)).unwrap();
    let paths: Vec<&str> = names.iter().map(String::as_str).collect();
    let out = run(signed_in(&api, Duration::from_secs(5)), BATCH.into(), dir.paths(&paths), cancel, emit).await.unwrap();
    assert_eq!(out.stored.len(), 0);
    assert_eq!(out.rejected.len(), 8);
    assert!(out.rejected.iter().all(|r| r.reason == Reason::Full));
    assert!(count(&log, PHOTOS) <= 3);
}

#[tokio::test]
async fn a_batch_with_250_photos_already_stored_still_takes_more() {
    let held: Vec<String> = (0..250).map(|i| format!("0b1c2d3e-0000-4000-8000-{i:012}")).collect();
    let (api, _) = mock(move |r, _| {
        let refs: Vec<&str> = held.iter().map(String::as_str).collect();
        shared(r, &refs).unwrap_or_else(|| stored(500))
    })
    .await;
    let dir = Folder::with("more", &[("a.jpg", 5), ("b.jpg", 5)]);
    let (emit, _) = collector();
    let (_a, cancel) = Uploader::default().begin().map(|(a, c)| (std::mem::ManuallyDrop::new(a), c)).unwrap();
    let out = run(signed_in(&api, Duration::from_secs(5)), BATCH.into(), dir.paths(&["a.jpg", "b.jpg"]), cancel, emit).await.unwrap();
    assert_eq!(out.stored.len(), 2);
    assert!(out.rejected.is_empty());
}

#[tokio::test]
async fn another_batch_is_refused_before_any_file_is_read() {
    let (api, log) = mock(|r, _| shared(r, &[]).unwrap_or_else(|| stored(1))).await;
    let (emit, _) = collector();
    let (_a, cancel) = Uploader::default().begin().map(|(a, c)| (std::mem::ManuallyDrop::new(a), c)).unwrap();
    let other = "0b1c2d3e-0000-4000-8000-0000000000ff";
    let e = run(signed_in(&api, Duration::from_secs(5)), other.into(), vec![PathBuf::from("/nope/a.jpg")], cancel, emit).await.unwrap_err();
    assert_eq!(e.kind, Kind::BadRequest);
    assert_eq!(count(&log, PHOTOS), 0);
}

#[tokio::test]
async fn cancel_stops_the_queue_and_keeps_what_is_stored() {
    let (api, _) = mock(|r, n| shared(r, &[]).unwrap_or_else(|| (1, stored(n).1))).await;
    let names = ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "6.jpg"];
    let dir = Folder::with("cancel", &names.map(|n| (n, 5)));
    let (emit, _) = collector();
    let uploader = Arc::new(Uploader::default());
    let (active, cancel) = uploader.begin().unwrap();
    let canceller = uploader.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        canceller.cancel();
    });
    let began = std::time::Instant::now();
    let out = run(signed_in(&api, Duration::from_secs(5)), BATCH.into(), dir.paths(&names), cancel, emit).await.unwrap();
    drop(active);
    assert!(out.cancelled);
    assert!(out.stored.is_empty(), "answers were still held when the cancel came");
    assert!(began.elapsed() < Duration::from_millis(900), "a cancel must not wait for the held answers");
}

#[tokio::test]
async fn a_second_run_is_refused_while_one_runs() {
    let uploader = Uploader::default();
    let first = uploader.begin().unwrap();
    assert_eq!(uploader.begin().err().unwrap().kind, Kind::BadRequest);
    drop(first);
    assert!(uploader.begin().is_ok());
}

#[test]
fn a_drop_nobody_watches_is_forgotten() {
    let uploader = Uploader::default();
    uploader.drop_files(vec![PathBuf::from("/x/a.jpg")]);
    assert!(uploader.take_drop().is_empty(), "nobody is watching, so the drop is forgotten");
}
