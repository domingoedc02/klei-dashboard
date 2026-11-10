//! Builds the .zip of Gowns the User asked to download (Story 5.4, FR-17).
//!
//! The archive is the one plaintext file this shell writes: FR-17 asks for it, and it lands only where the User chose in
//! the save dialog. Photos arrive one at a time over the signed session and are never kept; a failed or cancelled run
//! removes the file it created. The server never holds an archive either (it only answers a manifest).

use std::collections::HashSet;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::watch;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::{BridgeError, Kind};
use crate::session::{Payload, Session};
use crate::uploads::cancelled;

const NAME_CHARS: usize = 80;
const NAME_BYTES: usize = 200;
const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4",
    "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

#[derive(Debug, Deserialize)]
struct Manifest {
    items: Vec<Item>,
}

/// One Gown of the manifest; `details` is the text of its `details.txt`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub gown_id: String,
    pub name: String,
    pub photos: Vec<ExportPhoto>,
    pub details: String,
}

#[derive(Debug, Deserialize)]
pub struct ExportPhoto {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
}

/// `done` counts Gowns whose files are in the archive.
#[derive(Clone, Debug, Serialize)]
pub struct Progress {
    pub done: usize,
    pub total: usize,
}

pub type Emit = Arc<dyn Fn(Progress) + Send + Sync>;

#[derive(Default, Debug, Serialize)]
pub struct Summary {
    pub gowns: usize,
    pub photos: usize,
    pub cancelled: bool,
}

/// The single run slot, so a second Download cannot start while one runs.
#[derive(Default)]
pub struct Exporter {
    active: Mutex<Option<watch::Sender<bool>>>,
}

pub struct Active<'a>(&'a Exporter);

impl Drop for Active<'_> {
    fn drop(&mut self) {
        self.0.active.lock().unwrap().take();
    }
}

impl Exporter {
    pub fn begin(&self) -> Result<(Active<'_>, watch::Receiver<bool>), BridgeError> {
        let mut active = self.active.lock().unwrap();
        if active.is_some() {
            return Err(BridgeError::new(Kind::BadRequest, "a download is already running"));
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

fn fail(what: &str) -> BridgeError {
    BridgeError::new(Kind::Failed, what)
}

fn io<E>(_: E) -> BridgeError {
    fail("could not write the file")
}

/// A name that is safe as a file or folder name on macOS, Windows and Linux: no separators, no `..`, no control
/// characters, at most 80 characters, never empty and never a reserved Windows device name.
pub fn clean(raw: &str) -> String {
    let mut s: String = raw.chars().filter(|c| !c.is_control()).map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c }).collect();
    while s.contains("..") {
        s = s.replace("..", "");
    }
    let mut s: String = s.trim_matches(|c: char| c.is_whitespace() || c == '.').chars().take(NAME_CHARS).collect();
    while s.len() > NAME_BYTES {
        s.pop();
    }
    let s = s.trim_end_matches(|c: char| c.is_whitespace() || c == '.');
    if s.is_empty() {
        "gown".to_owned()
    } else if RESERVED.contains(&s.to_ascii_uppercase().as_str()) {
        format!("_{s}")
    } else {
        s.to_owned()
    }
}

/// [`clean`] plus a number when the name is taken (case-insensitive, like macOS and Windows disks).
pub fn unique(raw: &str, taken: &mut HashSet<String>) -> String {
    let base = clean(raw);
    let mut name = base.clone();
    let mut n = 1;
    while !taken.insert(name.to_lowercase()) {
        n += 1;
        name = format!("{base} ({n})");
    }
    name
}

fn extension(kind: &str) -> Result<&'static str, BridgeError> {
    match kind {
        "jpeg" => Ok("jpg"),
        "png" => Ok("png"),
        "webp" => Ok("webp"),
        _ => Err(fail("unknown photo type")),
    }
}

/// Asks the server which photos and details each Gown has. 413 means too many Gowns or too many bytes.
pub async fn fetch_manifest(session: &Session, ids: &[String]) -> Result<Vec<Item>, BridgeError> {
    let r = session.request_if("POST", "/api/v1/gowns/export", Some(json!({ "ids": ids })), None, None).await?;
    match r.status {
        200 => {
            let m: Manifest = serde_json::from_value(r.body.unwrap_or_default()).map_err(|_| fail("unreadable manifest"))?;
            Ok(m.items)
        }
        413 => Err(BridgeError::new(Kind::TooLarge, "too many to download at once")),
        403 => Err(BridgeError::new(Kind::NoAccess, "not allowed")),
        422 => Err(BridgeError::new(Kind::BadRequest, "bad request")),
        _ => Err(fail("the server could not prepare the download")),
    }
}

/// Writes the archive at `dest`: one folder per Gown when there is more than one. Removes `dest` unless it finished.
pub async fn build(session: &Session, items: &[Item], dest: &Path, cancel: watch::Receiver<bool>, emit: &Emit) -> Result<Summary, BridgeError> {
    let file = File::create(dest).map_err(io)?;
    let out = fill(session, items, file, cancel, emit).await;
    if !matches!(&out, Ok(s) if !s.cancelled) {
        let _ = std::fs::remove_file(dest);
    }
    out
}

async fn fill(session: &Session, items: &[Item], file: File, cancel: watch::Receiver<bool>, emit: &Emit) -> Result<Summary, BridgeError> {
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let timeout = session.config().upload_timeout;
    let mut zip = ZipWriter::new(file);
    let mut taken = HashSet::new();
    let mut photos = 0;
    emit(Progress { done: 0, total: items.len() });

    for (i, item) in items.iter().enumerate() {
        let dir = if items.len() > 1 { format!("{}/", unique(&item.name, &mut taken)) } else { String::new() };
        for (n, p) in item.photos.iter().enumerate() {
            let ext = extension(&p.kind)?;
            let path = format!("/api/v1/gowns/{}/photos/{}?size=full", item.gown_id, p.id);
            let raw = tokio::select! {
                r = session.call(reqwest::Method::GET, &path, Payload::Empty, timeout) => r?,
                _ = cancelled(cancel.clone()) => return Ok(Summary { cancelled: true, ..Summary::default() }),
            };
            if raw.status != 200 {
                return Err(fail("a photo could not be read"));
            }
            zip.start_file(format!("{dir}photo-{}.{ext}", n + 1), stored).map_err(io)?;
            zip.write_all(&raw.bytes).map_err(io)?;
            photos += 1;
        }
        zip.start_file(format!("{dir}details.txt"), deflated).map_err(io)?;
        zip.write_all(item.details.as_bytes()).map_err(io)?;
        emit(Progress { done: i + 1, total: items.len() });
    }
    zip.finish().map_err(io)?;
    Ok(Summary { gowns: items.len(), photos, cancelled: false })
}
