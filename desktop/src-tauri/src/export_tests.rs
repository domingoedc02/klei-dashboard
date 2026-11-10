use std::collections::HashSet;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;

use crate::error::Kind;
use crate::export::{build, clean, fetch_manifest, unique, Emit, ExportPhoto, Exporter, Item, Progress};
use crate::session_tests::{count, mock, mock_bytes, pair};
use crate::uploads_tests::signed_in;

const A: &str = "0b1c2d3e-0000-4000-8000-00000000000a";
const B: &str = "0b1c2d3e-0000-4000-8000-00000000000b";
const P1: &str = "0b1c2d3e-0000-4000-8000-000000000011";
const P2: &str = "0b1c2d3e-0000-4000-8000-000000000012";
const P3: &str = "0b1c2d3e-0000-4000-8000-000000000013";

fn item(gown: &str, name: &str, photos: &[(&str, &str)]) -> Item {
    Item {
        gown_id: gown.to_owned(),
        name: name.to_owned(),
        photos: photos.iter().map(|(id, kind)| ExportPhoto { id: (*id).to_owned(), kind: (*kind).to_owned() }).collect(),
        details: format!("Name: {name}\n"),
    }
}

fn dest(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!("klei-export-{}-{tag}.zip", std::process::id()))
}

fn collector() -> (Emit, Arc<Mutex<Vec<Progress>>>) {
    let seen: Arc<Mutex<Vec<Progress>>> = Arc::default();
    let sink = seen.clone();
    (Arc::new(move |p| sink.lock().unwrap().push(p)), seen)
}

fn entries(path: &PathBuf) -> Vec<(String, Vec<u8>)> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    (0..zip.len())
        .map(|i| {
            let mut f = zip.by_index(i).unwrap();
            let mut bytes = Vec::new();
            f.read_to_end(&mut bytes).unwrap();
            (f.name().unwrap().into_owned(), bytes)
        })
        .collect()
}

fn bytes_for(path: &str) -> Vec<u8> {
    format!("bytes of {path}").into_bytes()
}

#[test]
fn a_name_never_leaves_the_folder_it_is_written_in() {
    for hostile in ["../../etc/passwd", "..", "a/../b", "C:\\Windows\\x", "/abs/olute", "x\u{0}y\ncontrol", "  ..  ", "...", "con", "NUL", "a:b*c?d"] {
        let n = clean(hostile);
        assert!(!n.is_empty(), "{hostile:?}");
        assert!(!n.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']), "{hostile:?} -> {n:?}");
        assert!(!n.contains(".."), "{hostile:?} -> {n:?}");
        assert!(!n.chars().any(char::is_control), "{hostile:?} -> {n:?}");
        assert!(!n.starts_with('.') && !n.ends_with('.'), "{hostile:?} -> {n:?}");
    }
    assert_eq!(clean("con"), "_con");
    assert_eq!(clean(".."), "gown");
    assert_eq!(clean("Willow Rose"), "Willow Rose");
}

#[test]
fn emoji_and_long_names_are_cut_on_a_character_never_inside_one() {
    assert_eq!(clean("Gown 👰‍♀️ Rose"), "Gown 👰‍♀️ Rose");
    let long = "é".repeat(500);
    let n = clean(&long);
    assert_eq!(n.chars().count(), 80);
    let emoji = "👰".repeat(200);
    let n = clean(&emoji);
    assert!(n.chars().count() <= 80 && n.len() <= 200 && n.chars().all(|c| c == '👰'));
}

#[test]
fn two_gowns_with_one_name_get_a_number_whatever_the_case() {
    let mut taken = HashSet::new();
    assert_eq!(unique("Oak", &mut taken), "Oak");
    assert_eq!(unique("oak", &mut taken), "oak (2)");
    assert_eq!(unique("OAK", &mut taken), "OAK (3)");
}

#[tokio::test]
async fn one_gown_is_flat_with_photos_in_order_and_its_details() {
    let (api, log) = mock_bytes(|r, _| match r.path.as_str() {
        "/api/v1/auth/refresh" => (200, pair("access-1", "refresh-1").to_string().into_bytes()),
        p if p.contains("/photos/") => (200, bytes_for(p)),
        _ => (404, Vec::new()),
    })
    .await;
    let session = signed_in(&api, Duration::from_secs(5));
    let cancel = tokio::sync::watch::channel(false).1;
    let (emit, seen) = collector();
    let to = dest("flat");
    let summary = build(&session, &[item(A, "Willow", &[(P1, "jpeg"), (P2, "png")])], &to, cancel, &emit).await.unwrap();
    assert_eq!((summary.gowns, summary.photos, summary.cancelled), (1, 2, false));
    let got = entries(&to);
    assert_eq!(got.iter().map(|e| e.0.as_str()).collect::<Vec<_>>(), ["photo-1.jpg", "photo-2.png", "details.txt"]);
    assert_eq!(got[0].1, bytes_for(&format!("/api/v1/gowns/{A}/photos/{P1}?size=full")));
    assert_eq!(got[2].1, b"Name: Willow\n");
    assert_eq!(count(&log, &format!("/api/v1/gowns/{A}/photos/{P2}?size=full")), 1);
    assert_eq!(seen.lock().unwrap().iter().map(|p| (p.done, p.total)).collect::<Vec<_>>(), [(0, 1), (1, 1)]);
    let _ = std::fs::remove_file(&to);
}

#[tokio::test]
async fn several_gowns_get_a_folder_each_and_equal_names_stay_apart() {
    let (api, _) = mock_bytes(|r, _| match r.path.as_str() {
        "/api/v1/auth/refresh" => (200, pair("access-1", "refresh-1").to_string().into_bytes()),
        p => (200, bytes_for(p)),
    })
    .await;
    let session = signed_in(&api, Duration::from_secs(5));
    let (emit, seen) = collector();
    let to = dest("folders");
    let items = [item(A, "../Oak", &[(P1, "webp")]), item(B, "oak", &[(P2, "jpeg"), (P3, "jpeg")])];
    let summary = build(&session, &items, &to, tokio::sync::watch::channel(false).1, &emit).await.unwrap();
    assert_eq!((summary.gowns, summary.photos), (2, 3));
    let names: Vec<String> = entries(&to).into_iter().map(|e| e.0).collect();
    assert_eq!(names, ["_Oak/photo-1.webp", "_Oak/details.txt", "oak/photo-1.jpg", "oak/photo-2.jpg", "oak/details.txt"]);
    assert_eq!(seen.lock().unwrap().last().map(|p| (p.done, p.total)), Some((2, 2)));
    let _ = std::fs::remove_file(&to);
}

#[tokio::test]
async fn a_photo_that_fails_stops_the_run_and_removes_the_file() {
    let (api, log) = mock_bytes(|r, _| match r.path.as_str() {
        "/api/v1/auth/refresh" => (200, pair("access-1", "refresh-1").to_string().into_bytes()),
        p if p.contains(P2) => (500, Vec::new()),
        p => (200, bytes_for(p)),
    })
    .await;
    let session = signed_in(&api, Duration::from_secs(5));
    let (emit, _) = collector();
    let to = dest("failed");
    let items = [item(A, "Oak", &[(P1, "jpeg"), (P2, "jpeg"), (P3, "jpeg")])];
    let err = build(&session, &items, &to, tokio::sync::watch::channel(false).1, &emit).await.unwrap_err();
    assert_eq!(err.kind, Kind::Failed);
    assert!(!to.exists(), "partial file left behind");
    assert_eq!(count(&log, &format!("/api/v1/gowns/{A}/photos/{P3}?size=full")), 0, "went on after the failure");
}

#[tokio::test]
async fn cancel_stops_at_once_and_removes_the_file() {
    let (api, _) = mock_bytes(|r, _| match r.path.as_str() {
        "/api/v1/auth/refresh" => (200, pair("access-1", "refresh-1").to_string().into_bytes()),
        _ => (1, b"slow".to_vec()),
    })
    .await;
    let session = signed_in(&api, Duration::from_secs(5));
    let exporter = Arc::new(Exporter::default());
    let (slot, cancel) = exporter.begin().unwrap();
    assert!(exporter.begin().is_err(), "one download at a time");
    let (emit, _) = collector();
    let to = dest("cancelled");
    let stopper = exporter.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        stopper.cancel();
    });
    let started = std::time::Instant::now();
    let items = [item(A, "Oak", &[(P1, "jpeg"), (P2, "jpeg")])];
    let summary = build(&session, &items, &to, cancel, &emit).await.unwrap();
    assert!(summary.cancelled);
    assert!(started.elapsed() < Duration::from_millis(900), "waited for the slow photo");
    assert!(!to.exists(), "partial file left behind");
    drop(slot);
    assert!(exporter.begin().is_ok(), "the slot frees when the run ends");
}

#[tokio::test]
async fn the_manifest_maps_413_to_too_large_and_reads_the_items() {
    let (api, log) = mock(|r, _| match r.path.as_str() {
        "/api/v1/auth/refresh" => (200, pair("access-1", "refresh-1")),
        "/api/v1/gowns/export" if r.body["ids"].as_array().is_some_and(|a| a.len() > 1) => (413, json!({ "code": "too_large" })),
        "/api/v1/gowns/export" => (
            200,
            json!({ "items": [{ "gownId": A, "name": "Oak", "photos": [{ "id": P1, "type": "jpeg" }], "details": "Name: Oak\n" }], "missing": [] }),
        ),
        _ => (404, json!(null)),
    })
    .await;
    let session = signed_in(&api, Duration::from_secs(5));
    let items = fetch_manifest(&session, &[A.to_owned()]).await.unwrap();
    assert_eq!((items.len(), items[0].photos[0].kind.as_str()), (1, "jpeg"));
    let err = fetch_manifest(&session, &[A.to_owned(), B.to_owned()]).await.unwrap_err();
    assert_eq!(err.kind, Kind::TooLarge);
    assert_eq!(count(&log, "/api/v1/gowns/export"), 2);
}
