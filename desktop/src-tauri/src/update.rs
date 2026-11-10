//! Story 9.3 (FR-43): find, download, verify and install a new version.
//! No URL, key or path is named here: the endpoint and the public key come from tauri.conf.json,
//! and the plugin keeps the package in its own temp folder until it is installed.
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::{Error, Update, UpdaterExt};

use crate::error::{BridgeError, Kind};
use crate::session::Session;

const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
// shortcut: one flat limit for the whole download, so a very slow link fails; make it per chunk when installers pass ~100 MB.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

pub const UNVERIFIED: &str = "The update couldn't be verified. Nothing was changed.";
pub const DIRTY: &str = "You have unsent work. Finish or discard it first.";

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Status {
    None,
    Available { version: String },
}

/// Fixed texts only: the plugin's own messages can carry the update URL.
fn bridge(e: Error) -> BridgeError {
    match &e {
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) | Error::SignedVersionMismatch { .. } | Error::MissingSignedVersion => {
            BridgeError::new(Kind::UpdateUnverified, UNVERIFIED)
        }
        Error::Reqwest(r) if r.is_timeout() => BridgeError::new(Kind::Timeout, "The update server did not answer in time."),
        Error::Reqwest(r) if r.is_connect() => BridgeError::new(Kind::Offline, "The update server can't be reached."),
        _ => BridgeError::new(Kind::Failed, "The update could not be completed."),
    }
}

#[cfg(test)]
pub fn bridge_for_test(e: Error) -> BridgeError {
    bridge(e)
}

async fn find<R: Runtime>(app: &AppHandle<R>, timeout: Duration) -> Result<Option<Update>, BridgeError> {
    let updater = app.updater_builder().timeout(timeout).build().map_err(bridge)?;
    updater.check().await.map_err(bridge)
}

pub async fn check<R: Runtime>(app: &AppHandle<R>) -> Result<Status, BridgeError> {
    Ok(match find(app, CHECK_TIMEOUT).await? {
        Some(update) => Status::Available { version: update.version },
        None => Status::None,
    })
}

/// NFR-3: nothing installs while the User has unsent work.
pub fn gate(session: &Session) -> Result<(), BridgeError> {
    if session.is_dirty() {
        Err(BridgeError::new(Kind::UpdateRefused, DIRTY))
    } else {
        Ok(())
    }
}

/// A package the plugin has already verified against the embedded public key.
pub struct Ready {
    update: Update,
    bytes: Vec<u8>,
}

pub async fn download<R: Runtime>(app: &AppHandle<R>, session: &Session) -> Result<Ready, BridgeError> {
    gate(session)?;
    let update = find(app, DOWNLOAD_TIMEOUT).await?.ok_or_else(|| BridgeError::new(Kind::Failed, "No update is available."))?;
    let bytes = update.download(|_, _| {}, || {}).await.map_err(bridge)?;
    Ok(Ready { update, bytes })
}

impl Ready {
    #[cfg(test)]
    pub fn version(&self) -> &str {
        &self.update.version
    }

    /// Checks the gate again: the download can take minutes and the User may have started a Draft meanwhile.
    pub fn install(self, session: &Session) -> Result<(), BridgeError> {
        gate(session)?;
        self.update.install(&self.bytes).map_err(bridge)
    }
}
