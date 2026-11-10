use std::sync::Arc;
use std::time::Duration;

pub type Opener = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Clone)]
pub struct Config {
    pub api: String,
    pub auth: String,
    pub sign_in_timeout: Duration,
    pub request_timeout: Duration,
    /// One photo upload, up to 25 MB on a slow link.
    pub upload_timeout: Duration,
    /// Wait before an upload is re-sent after a network error or a busy server.
    pub retry_delay: Duration,
    pub loopback: bool,
    pub smoke: bool,
    pub open: Opener,
}

// Backend and Auth Web URLs are build-time constants (architecture §2); the webview never sees them.
const API: Option<&str> = option_env!("KLEI_API_URL");
const AUTH: Option<&str> = option_env!("KLEI_AUTH_URL");
const _: () = assert!(
    cfg!(debug_assertions) || (API.is_some() && AUTH.is_some()),
    "release builds need KLEI_API_URL and KLEI_AUTH_URL"
);

impl Config {
    pub fn build_time(loopback: bool, smoke: bool, open: Opener) -> Self {
        Self {
            api: API.unwrap_or("http://127.0.0.1:8080").trim_end_matches('/').to_owned(),
            auth: AUTH.unwrap_or("http://127.0.0.1:8081").trim_end_matches('/').to_owned(),
            sign_in_timeout: Duration::from_secs(300),
            request_timeout: Duration::from_secs(10),
            upload_timeout: Duration::from_secs(120),
            retry_delay: Duration::from_secs(3),
            loopback,
            smoke,
            open,
        }
    }
}
