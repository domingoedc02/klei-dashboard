//! The `klei-img://` scheme: thumbnails for the strip, fetched through the session and held in memory only (Story 4.2).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::session::{Payload, Session};

pub const TTL: Duration = Duration::from_secs(300);
const MAX_ENTRIES: usize = 400;

/// Batch (or Gown), Photo, whether the full image is wanted instead of the thumbnail, and whether the first id is a Gown (Story 5.1).
type Key = (String, String, bool, bool);
type Held = (Instant, Arc<Vec<u8>>);

pub struct Thumbs {
    ttl: Duration,
    held: Mutex<HashMap<Key, Held>>,
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

/// `/{batch}/{photo}[/full]` or `/g/{gown}/{photo}[/full]`, with slashes that may arrive percent-encoded. Anything else is refused, so
/// the path can never steer the API call somewhere else.
pub fn parse(path: &str) -> Option<Key> {
    let decoded = path.trim_start_matches('/').replace("%2F", "/").replace("%2f", "/");
    // `/me/{revision}`: the signed-in User's own avatar; the revision only busts the webview's cache (Story 6.1).
    if let Some(rev) = decoded.strip_prefix("me/") {
        return (!rev.is_empty() && rev.len() <= 18 && rev.bytes().all(|b| b.is_ascii_digit())).then(|| ("me".to_owned(), rev.to_owned(), false, false));
    }
    let mut parts = decoded.split('/').peekable();
    let gown = parts.next_if_eq(&"g").is_some();
    let (owner, photo, tail) = (parts.next()?, parts.next()?, parts.next());
    if parts.next().is_some() || !matches!(tail, None | Some("full")) {
        return None;
    }
    (is_uuid(owner) && is_uuid(photo)).then(|| (owner.to_owned(), photo.to_owned(), tail.is_some(), gown))
}

/// The image type from the first bytes; the backend serves JPEG thumbnails and the original type for full images.
pub fn mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

impl Thumbs {
    pub fn new(ttl: Duration) -> Self {
        Self { ttl, held: Mutex::default() }
    }

    /// The image bytes, or the HTTP status to answer with. Thumbnails are held for a while; a full image is read each time and never kept.
    pub async fn get(&self, session: &Session, key: &Key) -> Result<Arc<Vec<u8>>, u16> {
        // An avatar is never held: a cached one could outlive a sign-out and show the next person someone else's face.
        let own = key.0 == "me";
        if !key.2 && !own {
            if let Some((at, bytes)) = self.held.lock().unwrap().get(key) {
                if at.elapsed() < self.ttl {
                    return Ok(bytes.clone());
                }
            }
        }
        let root = if key.3 { "gowns" } else { "uploads" };
        let path = if own {
            "/api/v1/me/avatar".to_owned()
        } else {
            format!("/api/v1/{}/{}/photos/{}?size={}", root, key.0, key.1, if key.2 { "full" } else { "thumb" })
        };
        let raw = session
            .call(reqwest::Method::GET, &path, Payload::Empty, session.config().request_timeout)
            .await
            .map_err(|_| 503u16)?;
        if raw.status != 200 {
            return Err(if raw.status == 404 { 404 } else { 502 });
        }
        let bytes = Arc::new(raw.bytes);
        if key.2 || own {
            return Ok(bytes);
        }
        let mut held = self.held.lock().unwrap();
        held.retain(|_, (at, _)| at.elapsed() < self.ttl);
        if held.len() < MAX_ENTRIES {
            held.insert(key.clone(), (Instant::now(), bytes.clone()));
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const B: &str = "0b1c2d3e-0000-4000-8000-000000000001";
    const P: &str = "0b1c2d3e-0000-4000-8000-000000000002";

    #[test]
    fn only_two_uuids_make_a_path() {
        assert_eq!(parse(&format!("/{B}/{P}")), Some((B.into(), P.into(), false, false)));
        assert_eq!(parse(&format!("/{B}/{P}/full")), Some((B.into(), P.into(), true, false)));
        assert_eq!(parse(&format!("/{B}%2F{P}")), Some((B.into(), P.into(), false, false)));
        assert_eq!(parse(&format!("/{B}%2f{P}%2Ffull")), Some((B.into(), P.into(), true, false)));
        assert_eq!(parse(&format!("/g/{B}/{P}")), Some((B.into(), P.into(), false, true)));
        assert_eq!(parse(&format!("/g%2F{B}%2F{P}%2Ffull")), Some((B.into(), P.into(), true, true)));
        assert_eq!(parse(&format!("/g/{B}")), None);
        assert_eq!(parse(&format!("/g/g/{B}/{P}")), None);
        assert_eq!(parse(&format!("/x/{B}/{P}")), None);
        assert_eq!(parse(&format!("/{B}/{P}/other")), None);
        assert_eq!(parse(&format!("/{B}/{P}/full/x")), None);
        assert_eq!(parse(&format!("/{B}/../{P}")), None);
        assert_eq!(parse(&format!("/{B}/{P}?size=full")), None);
        assert_eq!(parse(&format!("/{B}")), None);
        assert_eq!(parse("/a/b"), None);
    }

    #[test]
    fn own_avatar_takes_only_a_numeric_revision() {
        assert_eq!(parse("/me/1731000000000"), Some(("me".into(), "1731000000000".into(), false, false)));
        assert_eq!(parse("/me%2F7"), Some(("me".into(), "7".into(), false, false)));
        for bad in ["/me", "/me/", "/me/x", "/me/1/full", "/me/../1", "/me/1234567890123456789", "/mee/1"] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn mime_follows_the_first_bytes() {
        assert_eq!(mime(&[0x89, b'P', b'N', b'G', 1]), "image/png");
        assert_eq!(mime(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
        assert_eq!(mime(&[0xFF, 0xD8, 0xFF]), "image/jpeg");
        assert_eq!(mime(&[]), "image/jpeg");
    }
}
