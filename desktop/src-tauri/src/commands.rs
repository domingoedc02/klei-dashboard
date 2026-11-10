use std::sync::Arc;

use serde::Deserialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::error::{BridgeError, Kind};
use crate::keychain::SwitchKeychain;
use crate::export::{self as exports, Exporter};
use crate::session::{ApiResponse, Session};
use crate::update;
use crate::uploads::{self, Emit, Event, Summary, Uploader, EXTENSIONS};

/// The closed command set. build.rs, lib.rs and capabilities/default.json must list exactly these (tests/contract.rs).
pub const NAMES: [&str; 9] = [
    "api_request",
    "sign_in",
    "sign_out",
    "upload_files",
    "export_gowns",
    "check_update",
    "install_update",
    "set_dirty",
    "session_only",
];

#[derive(Deserialize)]
pub struct ApiCall {
    method: String,
    path: String,
    body: Option<Value>,
    #[serde(rename = "ifMatch")]
    if_match: Option<u64>,
    #[serde(rename = "idempotencyKey", default)]
    idempotency_key: Option<String>,
}

#[tauri::command]
pub async fn api_request(
    app: AppHandle,
    session: State<'_, Arc<Session>>,
    request: ApiCall,
) -> Result<ApiResponse, BridgeError> {
    let result = session.request_if(&request.method, &request.path, request.body, request.if_match, request.idempotency_key.as_deref()).await;
    // KLEI_SMOKE=1: the first answer the webview gets is "signed out", which proves the IPC round trip under the CSP.
    // Exit a moment later so the signed-out screen is drawn before the process ends.
    if session.config().smoke && matches!(&result, Err(e) if e.kind == Kind::SignedOut) {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            app.exit(0);
        });
    }
    result
}

#[tauri::command]
pub async fn sign_in(session: State<'_, Arc<Session>>) -> Result<(), BridgeError> {
    let session: Arc<Session> = session.inner().clone();
    session.sign_in().await
}

#[tauri::command]
pub async fn sign_out(session: State<'_, Arc<Session>>) -> Result<(), BridgeError> {
    session.sign_out().await
}

/// `kind`: `attachment` picks files for the Reply of Inquiry `target_id` and sends them one by one, `avatar` picks one file and sets it as the User's own avatar (`target_id` unused), `photo` opens the file dialog, `dropped` sends the files the User just dropped on the window, `cancel` stops
/// the running upload, `watch` and `unwatch` start and stop drag-and-drop news on `on_event`. `target_id` is the Upload
/// Batch. Files are read here and never reach the webview (AD-10).
#[tauri::command]
pub async fn upload_files(
    app: AppHandle,
    session: State<'_, Arc<Session>>,
    uploader: State<'_, Uploader>,
    kind: String,
    target_id: String,
    on_event: Channel<Event>,
) -> Result<Summary, BridgeError> {
    let paths = match kind.as_str() {
        "cancel" => {
            uploader.cancel();
            return Ok(Summary::default());
        }
        "watch" => {
            uploader.watch(on_event);
            return Ok(Summary::default());
        }
        "unwatch" => {
            uploader.unwatch();
            return Ok(Summary::default());
        }
        "avatar" => {
            let (tx, rx) = tokio::sync::oneshot::channel();
            app.dialog().file().add_filter("Photos", &EXTENSIONS).pick_file(move |picked| {
                let _ = tx.send(picked);
            });
            let picked = rx.await.map_err(|_| BridgeError::new(Kind::Failed, "file dialog closed"))?;
            let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
                return Ok(Summary { cancelled: true, ..Summary::default() });
            };
            return uploads::set_avatar(session.inner(), path).await;
        }
        "attachment" => {
            let (tx, rx) = tokio::sync::oneshot::channel();
            app.dialog().file().pick_files(move |picked| {
                let _ = tx.send(picked);
            });
            let picked = rx.await.map_err(|_| BridgeError::new(Kind::Failed, "file dialog closed"))?;
            let paths: Vec<_> = picked.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).collect();
            if paths.is_empty() {
                return Ok(Summary { cancelled: true, ..Summary::default() });
            }
            return uploads::attach_files(session.inner(), &target_id, paths).await;
        }
        "dropped" => uploader.take_drop(),
        "photo" => {
            let (tx, rx) = tokio::sync::oneshot::channel();
            app.dialog().file().add_filter("Photos", &EXTENSIONS).pick_files(move |picked| {
                let _ = tx.send(picked);
            });
            let picked = rx.await.map_err(|_| BridgeError::new(Kind::Failed, "file dialog closed"))?;
            picked.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).collect()
        }
        _ => return Err(BridgeError::new(Kind::BadRequest, "unknown upload kind")),
    };
    if paths.is_empty() {
        return Ok(Summary::default());
    }
    let (_slot, cancel) = uploader.begin()?;
    let emit: Emit = Arc::new(move |p| {
        let _ = on_event.send(Event::Progress(p));
    });
    uploads::run(session.inner().clone(), target_id, paths, cancel, emit).await
}

/// FR-17. `kind`: `start` asks the server for the manifest, opens the save dialog and writes the .zip where the User chose,
/// reporting Gowns done on `on_event`; `cancel` stops the running download and removes the partial file. Photos never reach the webview.
#[tauri::command]
pub async fn export_gowns(
    app: AppHandle,
    session: State<'_, Arc<Session>>,
    exporter: State<'_, Exporter>,
    kind: String,
    ids: Vec<String>,
    on_event: Channel<exports::Progress>,
) -> Result<exports::Summary, BridgeError> {
    match kind.as_str() {
        "cancel" => {
            exporter.cancel();
            return Ok(exports::Summary::default());
        }
        "start" => {}
        _ => return Err(BridgeError::new(Kind::BadRequest, "unknown download kind")),
    }
    if ids.is_empty() {
        return Err(BridgeError::new(Kind::BadRequest, "nothing to download"));
    }
    let (_slot, cancel) = exporter.begin()?;
    let items = exports::fetch_manifest(&session, &ids).await?;
    if items.is_empty() {
        return Err(BridgeError::new(Kind::Failed, "those gowns no longer exist"));
    }
    let suggested = if items.len() == 1 { format!("{}.zip", exports::clean(&items[0].name)) } else { "klei-gowns.zip".to_owned() };
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().add_filter("Zip archive", &["zip"]).set_file_name(suggested).save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = rx.await.map_err(|_| BridgeError::new(Kind::Failed, "file dialog closed"))?;
    let Some(dest) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(exports::Summary { cancelled: true, ..Default::default() });
    };
    let emit: exports::Emit = Arc::new(move |p| {
        let _ = on_event.send(p);
    });
    exports::build(&session, &items, &dest, cancel, &emit).await
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<update::Status, BridgeError> {
    update::check(&app).await
}

#[tauri::command]
pub async fn install_update(app: AppHandle, session: State<'_, Arc<Session>>) -> Result<(), BridgeError> {
    let ready = update::download(&app, &session).await?;
    ready.install(&session)?;
    // Windows exits inside install; macOS and Linux need the new bundle started by hand.
    app.restart()
}

#[tauri::command]
pub async fn set_dirty(session: State<'_, Arc<Session>>, dirty: bool) -> Result<(), BridgeError> {
    session.set_dirty(dirty);
    Ok(())
}

/// "Continue without saving": the refresh token stays in memory, so the next launch asks for sign-in again.
#[tauri::command]
pub fn session_only(keychain: State<'_, Arc<SwitchKeychain>>) {
    keychain.use_memory();
}
