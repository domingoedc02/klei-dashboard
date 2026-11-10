//! Story 9.3: the update flow against a local feed signed with a throwaway key (tests/fixtures/update).
//! Nothing here calls `install`: that would replace the test binary. The gate in front of it is tested instead.
use std::sync::{Arc, OnceLock};

use serde_json::json;
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::App;

use crate::error::Kind;
use crate::keychain::MemoryKeychain;
use crate::session_tests::{mock_bytes, session, Log};
use crate::update::{self, Status, DIRTY, UNVERIFIED};

const PKG: &[u8] = include_bytes!("../tests/fixtures/update/package.bin");
const PUB: &str = include_str!("../tests/fixtures/update/public.key");
const SIG_2: &str = include_str!("../tests/fixtures/update/package-2.0.0.sig");
const SIG_9: &str = include_str!("../tests/fixtures/update/package-9.9.9.sig");
const SIG_BARE: &str = include_str!("../tests/fixtures/update/package-noversion.sig");

/// A feed announcing `version`, with `sig` for `package`; the app is version 0.1.0.
async fn serve(version: &'static str, sig: &'static str, package: Vec<u8>) -> (String, Log) {
    let base = Arc::new(OnceLock::<String>::new());
    let seen = base.clone();
    let (url, log) = mock_bytes(move |r, _| {
        if r.path.starts_with("/latest/") {
            let platforms = json!({ tauri_plugin_updater::target().unwrap(): { "url": format!("{}/pkg", seen.get().unwrap()), "signature": sig.trim() } });
            (200, json!({ "version": version, "platforms": platforms }).to_string().into_bytes())
        } else if r.path == "/pkg" {
            (200, package.clone())
        } else {
            (404, Vec::new())
        }
    })
    .await;
    base.set(url.clone()).unwrap();
    (url, log)
}

/// The plugin configured the way tauri.conf.json does, except the test feed is plain http.
fn app(base: &str) -> App<MockRuntime> {
    let mut ctx = mock_context(noop_assets());
    ctx.config_mut().plugins.0.insert(
        "updater".into(),
        json!({
            "endpoints": [format!("{base}/latest/{{{{current_version}}}}/{{{{target}}}}/{{{{arch}}}}")],
            "pubkey": PUB.trim(),
            "requireSignedVersion": true,
            "dangerousInsecureTransportProtocol": true,
        }),
    );
    mock_builder().plugin(tauri_plugin_updater::Builder::new().build()).build(ctx).unwrap()
}

fn clean() -> Arc<crate::session::Session> {
    session("http://127.0.0.1:1", Arc::new(MemoryKeychain::default()))
}

async fn download_error(version: &'static str, sig: &'static str, package: Vec<u8>) -> crate::error::BridgeError {
    let (base, _) = serve(version, sig, package).await;
    let app = app(&base);
    match update::download(app.handle(), &clean()).await {
        Ok(_) => panic!("the package must be refused"),
        Err(e) => e,
    }
}

#[tokio::test]
async fn a_newer_version_is_announced_and_the_request_carries_only_version_and_platform() {
    let (base, log) = serve("2.0.0", SIG_2, PKG.to_vec()).await;
    let app = app(&base);
    assert_eq!(update::check(app.handle()).await.unwrap(), Status::Available { version: "2.0.0".into() });
    let (os, arch) = tauri_plugin_updater::target().unwrap().split_once('-').map(|(o, a)| (o.to_owned(), a.to_owned())).unwrap();
    let seen = log.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].path, format!("/latest/0.1.0/{os}/{arch}"));
    assert!(seen[0].auth.is_empty(), "no token goes to the update host");
}

#[tokio::test]
async fn the_same_version_and_an_empty_answer_both_mean_none() {
    let (base, _) = serve("0.1.0", SIG_2, PKG.to_vec()).await;
    assert_eq!(update::check(app(&base).handle()).await.unwrap(), Status::None);
    let (empty, _) = mock_bytes(|_, _| (204, Vec::new())).await;
    assert_eq!(update::check(app(&empty).handle()).await.unwrap(), Status::None);
}

#[tokio::test]
async fn an_unreachable_host_fails_without_naming_the_address() {
    let app = app("http://127.0.0.1:1");
    let e = update::check(app.handle()).await.unwrap_err();
    assert!(matches!(e.kind, Kind::Offline | Kind::Failed | Kind::Timeout), "{:?}", e.kind);
    assert!(!e.message.contains("127.0.0.1"));
}

#[tokio::test]
async fn a_signed_package_downloads_verified_and_waits_for_the_gate() {
    let (base, _) = serve("2.0.0", SIG_2, PKG.to_vec()).await;
    let app = app(&base);
    let s = clean();
    let Ok(ready) = update::download(app.handle(), &s).await else { panic!("verified package") };
    assert_eq!(ready.version(), "2.0.0");
    // Unsent work started while the package was coming down: the install is refused and nothing is replaced.
    s.set_dirty(true);
    let e = ready.install(&s).unwrap_err();
    assert_eq!((e.kind, e.message.as_str()), (Kind::UpdateRefused, DIRTY));
}

#[tokio::test]
async fn a_modified_package_is_rejected() {
    let mut bad = PKG.to_vec();
    bad[0] ^= 1;
    let e = download_error("2.0.0", SIG_2, bad).await;
    assert_eq!((e.kind, e.message.as_str()), (Kind::UpdateUnverified, UNVERIFIED));
}

#[tokio::test]
async fn an_unsigned_package_is_rejected() {
    let e = download_error("2.0.0", "bm90IGEgc2lnbmF0dXJl", PKG.to_vec()).await;
    assert_eq!(e.kind, Kind::UpdateUnverified);
}

#[tokio::test]
async fn a_signature_for_another_version_or_without_one_is_rejected() {
    assert_eq!(download_error("2.0.0", SIG_9, PKG.to_vec()).await.kind, Kind::UpdateUnverified);
    assert_eq!(download_error("2.0.0", SIG_BARE, PKG.to_vec()).await.kind, Kind::UpdateUnverified);
}

#[tokio::test]
async fn unsent_work_stops_the_install_before_any_request() {
    let (base, log) = serve("2.0.0", SIG_2, PKG.to_vec()).await;
    let app = app(&base);
    let s = clean();
    s.set_dirty(true);
    let e = update::download(app.handle(), &s).await.err().expect("refused");
    assert_eq!((e.kind, e.message.as_str()), (Kind::UpdateRefused, DIRTY));
    assert!(log.lock().unwrap().is_empty(), "nothing was asked of the update host");
}

#[test]
fn plugin_errors_map_to_fixed_texts() {
    use tauri_plugin_updater::Error;
    
    let e = crate::update::bridge_for_test(Error::MissingSignedVersion);
    assert_eq!(e.kind, Kind::UpdateUnverified);
    let e = crate::update::bridge_for_test(Error::EmptyEndpoints);
    assert_eq!((e.kind, e.message.as_str()), (Kind::Failed, "The update could not be completed."));
}
