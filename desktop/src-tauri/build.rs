// The closed command set (architecture §2): every command the webview may call is listed here and nowhere else.
// tests/contract.rs fails when this list, lib.rs, or capabilities/default.json drift apart.
const COMMANDS: &[&str] = &[
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

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri build");
}
