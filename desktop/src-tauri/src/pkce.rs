use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn random(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("operating system random source");
    URL_SAFE_NO_PAD.encode(buf)
}

/// 32 random bytes give a 43-character verifier, the shortest RFC 7636 allows.
pub fn generate() -> Pkce {
    let verifier = random(32);
    let challenge = challenge_for(&verifier);
    Pkce { verifier, challenge }
}

/// 24 bytes give 32 characters, inside the backend's `[A-Za-z0-9._~-]{16,128}`.
pub fn state() -> String {
    random(24)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_backend_test_vector() {
        assert_eq!(
            challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn generated_values_fit_the_backend_rules() {
        let p = generate();
        assert_eq!(p.verifier.len(), 43);
        assert_eq!(p.challenge.len(), 43);
        assert_ne!(p.verifier, generate().verifier);
        let s = state();
        assert!((16..=128).contains(&s.len()));
        assert!(s.chars().all(|c| c.is_ascii_alphanumeric() || "._~-".contains(c)));
    }
}
