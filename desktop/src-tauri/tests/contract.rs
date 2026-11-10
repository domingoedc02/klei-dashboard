//! Guards the shell's trust boundary: the closed command set, the CSP, and "nothing persists outside the keychain".
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read(rel: &str) -> String {
    fs::read_to_string(root().join(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

fn expected() -> BTreeSet<String> {
    klei_desktop_lib::COMMANDS.iter().map(|s| s.to_string()).collect()
}

fn files(dir: &Path, ext: &[&str], out: &mut Vec<PathBuf>) {
    for e in fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            files(&p, ext, out);
        } else if p.extension().is_some_and(|x| ext.iter().any(|w| x == *w)) {
            out.push(p);
        }
    }
}

#[test]
fn the_nine_commands_and_no_others() {
    let want: BTreeSet<String> = [
        "api_request", "sign_in", "sign_out", "upload_files", "export_gowns", "check_update", "install_update", "set_dirty", "session_only",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    assert_eq!(expected(), want);

    let build = read("build.rs");
    let in_build: BTreeSet<String> = build
        .split("const COMMANDS")
        .nth(1).unwrap()
        .split("];").next().unwrap()
        .split('"').skip(1).step_by(2).map(str::to_owned).collect();
    assert_eq!(in_build, want, "build.rs command list");

    let lib = read("src/lib.rs");
    let handler = lib.split("generate_handler![").nth(1).unwrap().split(']').next().unwrap();
    let in_handler: BTreeSet<String> =
        handler.split(',').map(|s| s.trim().trim_start_matches("commands::").to_owned()).filter(|s| !s.is_empty()).collect();
    assert_eq!(in_handler, want, "invoke_handler list");

    let commands_rs = read("src/commands.rs");
    assert_eq!(commands_rs.matches("#[tauri::command]").count(), want.len(), "extra #[tauri::command]");

    let cap: Value = serde_json::from_str(&read("capabilities/default.json")).unwrap();
    let granted: BTreeSet<String> = cap["permissions"]
        .as_array().unwrap().iter()
        .map(|p| p.as_str().unwrap().strip_prefix("allow-").expect("only allow-<command> grants").replace('-', "_"))
        .collect();
    assert_eq!(granted, want, "capabilities/default.json grants");

    let caps = fs::read_dir(root().join("capabilities")).unwrap().count();
    assert_eq!(caps, 1, "one capability file only");
}

#[test]
fn csp_is_not_loosened() {
    let conf: Value = serde_json::from_str(&read("tauri.conf.json")).unwrap();
    assert_eq!(
        conf["app"]["security"]["csp"],
        "default-src 'self'; img-src 'self' klei-img: data:; connect-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'"
    );
    assert_eq!(conf["identifier"], "co.klei.bridal");
    assert_eq!(conf["plugins"]["deep-link"]["desktop"]["schemes"], serde_json::json!(["klei"]));
    assert_eq!(conf["app"]["windows"][0]["minWidth"], 1100);
    assert_eq!(conf["app"]["windows"][0]["minHeight"], 700);
    assert_eq!(conf["app"]["withGlobalTauri"], false);
}

#[test]
fn the_update_url_is_the_only_address_besides_the_csp_and_nothing_is_loosened() {
    let conf: Value = serde_json::from_str(&read("tauri.conf.json")).unwrap();
    let u = &conf["plugins"]["updater"];
    let endpoints = u["endpoints"].as_array().expect("endpoints");
    assert_eq!(endpoints.len(), 1, "one update URL");
    assert!(endpoints[0].as_str().unwrap().starts_with("https://"), "https only");
    assert_eq!(u["requireSignedVersion"], true);
    assert!(u["pubkey"].as_str().is_some_and(|k| !k.is_empty()), "public key is embedded");
    let keys: BTreeSet<&str> = u.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(keys, BTreeSet::from(["endpoints", "pubkey", "requireSignedVersion"]), "no dangerous or extra updater flags");

    // Every address in the file: the schema comment, the dev-server pair, the updater URL, nothing else.
    let text = read("tauri.conf.json");
    let urls: BTreeSet<&str> = text.split(|c: char| c == '"' || c.is_whitespace() || c == ';')
        .filter(|w| w.starts_with("http://") || w.starts_with("https://") || w.starts_with("ws://")).collect();
    let want: BTreeSet<&str> = [
        "https://schema.tauri.app/config/2", "http://localhost:1420", "ws://localhost:1420", endpoints[0].as_str().unwrap(),
    ].into_iter().collect();
    assert_eq!(urls, want, "network addresses in tauri.conf.json");

    // The webview must not be able to call the plugin: capabilities grant the eight commands only.
    assert!(!read("capabilities/default.json").contains("updater:"), "no updater:* permission");
    assert_eq!(conf["app"]["withGlobalTauri"], false);
}

#[test]
fn nothing_is_written_outside_the_keychain() {
    let mut rust = Vec::new();
    files(&root().join("src"), &["rs"], &mut rust);
    // uploads.rs reads the photos the User picked (Story 4.2); it is the one file that may touch std::fs, and only to read.
    let writes = ["tokio::fs", "File::create", "OpenOptions", "fs::write", "fs::copy", "fs::rename", "create_dir", "remove_file", "set_secret"];
    for f in rust {
        if f.to_string_lossy().ends_with("_tests.rs") {
            continue;
        }
        let text = fs::read_to_string(&f).unwrap();
        let reader = f.ends_with("uploads.rs");
        // export.rs writes the one .zip the User chose in the save dialog (Story 5.4, FR-17) and removes it again when the run fails or is cancelled.
        let writer = f.ends_with("export.rs");
        let banned = writes.iter().chain(if reader || writer { None } else { Some(&"std::fs") });
        for b in banned {
            if writer && (*b == "File::create" || *b == "remove_file") {
                continue;
            }
            assert!(!text.contains(b), "{} uses {b}", f.display());
        }
        if writer {
            for call in text.match_indices("std::fs::").map(|(i, _)| &text[i + 9..]) {
                assert!(call.starts_with("remove_file(") || call.starts_with("File"), "export.rs: unexpected std::fs call near {}", &call[..call.len().min(24)]);
            }
            assert_eq!(text.matches("File::create(").count(), 1, "export.rs creates exactly one file");
        }
        if reader {
            // metadata and read are the only calls it may make
            for call in text.match_indices("std::fs::").map(|(i, _)| &text[i + 9..]) {
                assert!(call.starts_with("metadata(") || call.starts_with("read("), "uploads.rs: unexpected std::fs call near {}", &call[..call.len().min(24)]);
            }
        }
    }

    let mut web = Vec::new();
    files(&root().join("../src"), &["ts", "tsx"], &mut web);
    for f in web {
        if f.to_string_lossy().contains(".test.") || f.ends_with("test-setup.ts") {
            continue;
        }
        let text = fs::read_to_string(&f).unwrap();
        for b in ["localStorage", "sessionStorage", "indexedDB", "document.cookie"] {
            assert!(!text.contains(b), "{} uses {b}", f.display());
        }
    }
}
