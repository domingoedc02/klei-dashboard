use serde::Serialize;

/// What the webview sees when a command fails. Messages never carry tokens, codes or response bodies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    SignedOut,
    KeychainUnavailable,
    SessionExpired,
    NoAccess,
    Failed,
    Timeout,
    Cancelled,
    Offline,
    BadRequest,
    TooLarge,
    UpdateRefused,
    UpdateUnverified,
}

#[derive(Debug, Clone, Serialize)]
pub struct BridgeError {
    pub kind: Kind,
    pub message: String,
}

impl BridgeError {
    pub fn new(kind: Kind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
}
