mod commands;
mod config;
mod error;
mod export;
mod keychain;
mod loopback;
mod pkce;
mod session;
mod thumbs;
mod update;
mod uploads;
#[cfg(test)]
mod export_tests;
#[cfg(test)]
mod session_tests;
#[cfg(test)]
mod update_tests;
#[cfg(test)]
mod uploads_tests;

use std::sync::Arc;

use tauri::{AppHandle, DragDropEvent, Manager, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

use crate::config::Config;
use crate::keychain::SwitchKeychain;
use crate::session::Session;
use crate::thumbs::Thumbs;
use crate::uploads::Uploader;

pub use commands::NAMES as COMMANDS;

fn on_urls(app: &AppHandle, urls: Vec<Url>) {
    let session: Arc<Session> = app.state::<Arc<Session>>().inner().clone();
    for url in urls.into_iter().filter(|u| u.scheme() == "klei" && u.host_str() == Some("auth") && u.path() == "/callback") {
        let s = session.clone();
        tauri::async_runtime::spawn(async move {
            let _ = s.complete(&url).await;
        });
    }
}

pub fn run() {
    let smoke = std::env::var("KLEI_SMOKE").is_ok_and(|v| v == "1");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Uploader::default())
        .manage(export::Exporter::default())
        .manage(Thumbs::new(thumbs::TTL))
        .register_asynchronous_uri_scheme_protocol("klei-img", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let (get, key) = (request.method() == tauri::http::Method::GET, thumbs::parse(request.uri().path()));
            tauri::async_runtime::spawn(async move {
                let result = match (get, key, app.try_state::<Arc<Session>>()) {
                    (true, Some(key), Some(session)) => app.state::<Thumbs>().get(&session, &key).await,
                    _ => Err(400),
                };
                // no-store keeps the webview from writing the picture into its own disk cache (NFR-1).
                let base = tauri::http::Response::builder().header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
                responder.respond(match result {
                    Ok(bytes) => base.status(200).header("Content-Type", thumbs::mime(&bytes)).body(bytes.to_vec()),
                    Err(status) => base.status(status).body(Vec::new()),
                }.expect("response"));
            });
        })
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(drag) = event {
                let uploader = window.app_handle().state::<Uploader>();
                match drag {
                    DragDropEvent::Enter { .. } => uploader.drag(true),
                    DragDropEvent::Leave => uploader.drag(false),
                    DragDropEvent::Drop { paths, .. } => {
                        uploader.drag(false);
                        uploader.drop_files(paths.clone());
                    }
                    _ => {}
                }
            }
        })
        .setup(move |app| {
            let dl = app.deep_link();
            #[cfg(any(target_os = "linux", windows))]
            let _ = dl.register_all();
            let loopback = cfg!(target_os = "linux") && !dl.is_registered("klei").unwrap_or(false)
                || std::env::var("KLEI_LOOPBACK").is_ok_and(|v| v == "1");
            let open: config::Opener = Arc::new(|url| {
                let _ = open::that(url);
            });
            // Memory token: CI smoke (no keychain) and debug builds (every rebuild is a new ad-hoc identity, so the OS asks again). `KLEI_KEYCHAIN=os` forces the real one in dev.
            let memory = smoke || (cfg!(debug_assertions) && std::env::var("KLEI_KEYCHAIN").map_or(true, |v| v != "os"));
            let keychain = Arc::new(SwitchKeychain::new(memory));
            app.manage(keychain.clone());
            app.manage(Arc::new(Session::new(Config::build_time(loopback, smoke, open), keychain)));
            if smoke {
                let h = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                    h.exit(1);
                });
            }
            let handle = app.handle().clone();
            dl.on_open_url(move |event| on_urls(&handle, event.urls()));
            if let Ok(Some(urls)) = dl.get_current() {
                on_urls(app.handle(), urls);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::api_request,
            commands::sign_in,
            commands::sign_out,
            commands::upload_files,
            commands::export_gowns,
            commands::check_update,
            commands::install_update,
            commands::set_dirty,
            commands::session_only,
        ])
        .run(tauri::generate_context!())
        .expect("run Klei Bridal");
}
