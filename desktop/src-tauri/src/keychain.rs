use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// The only place the refresh token lives between launches: the OS keychain. No file, no localStorage, no silent fallback (fail closed).
/// Process memory is used only when chosen: smoke runs, debug builds, or the User's "Continue without saving".
#[derive(Debug)]
pub struct KeychainError;

pub trait Keychain: Send + Sync {
    fn load(&self) -> Result<Option<String>, KeychainError>;
    fn store(&self, token: &str) -> Result<(), KeychainError>;
    fn clear(&self) -> Result<(), KeychainError>;
}

const SERVICE: &str = "co.klei.bridal";
const ACCOUNT: &str = "refresh-token";

pub struct OsKeychain;

fn entry() -> Result<keyring::Entry, KeychainError> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| KeychainError)
}

impl Keychain for OsKeychain {
    fn load(&self) -> Result<Option<String>, KeychainError> {
        match entry()?.get_password() {
            Ok(t) => Ok(Some(t)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => {
                eprintln!("keychain read failed: {e}"); // the OS error only, never the token
                Err(KeychainError)
            }
        }
    }

    fn store(&self, token: &str) -> Result<(), KeychainError> {
        entry()?.set_password(token).map_err(|e| {
            eprintln!("keychain write failed: {e}");
            KeychainError
        })
    }

    fn clear(&self) -> Result<(), KeychainError> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(KeychainError),
        }
    }
}

/// OS keychain until `use_memory` is called (or from the start), then process memory. Memory never reaches disk.
pub struct SwitchKeychain {
    os: OsKeychain,
    mem: MemoryKeychain,
    memory: AtomicBool,
}

impl SwitchKeychain {
    pub fn new(memory: bool) -> Self {
        Self { os: OsKeychain, mem: MemoryKeychain::default(), memory: AtomicBool::new(memory) }
    }

    pub fn use_memory(&self) {
        self.memory.store(true, Ordering::SeqCst);
    }

    fn pick(&self) -> &dyn Keychain {
        if self.memory.load(Ordering::SeqCst) { &self.mem } else { &self.os }
    }
}

impl Keychain for SwitchKeychain {
    fn load(&self) -> Result<Option<String>, KeychainError> {
        self.pick().load()
    }

    fn store(&self, token: &str) -> Result<(), KeychainError> {
        self.pick().store(token)
    }

    fn clear(&self) -> Result<(), KeychainError> {
        self.pick().clear()
    }
}

/// Process memory only. Used by the smoke launch (CI machines have no keychain) and by tests.
#[derive(Default)]
pub struct MemoryKeychain {
    slot: Mutex<Option<String>>,
    broken: AtomicBool,
}

impl MemoryKeychain {
    #[cfg(test)]
    pub fn broken() -> Self {
        Self { slot: Mutex::default(), broken: AtomicBool::new(true) }
    }

    fn check(&self) -> Result<(), KeychainError> {
        if self.broken.load(Ordering::SeqCst) {
            Err(KeychainError)
        } else {
            Ok(())
        }
    }
}

impl Keychain for MemoryKeychain {
    fn load(&self) -> Result<Option<String>, KeychainError> {
        self.check()?;
        Ok(self.slot.lock().unwrap().clone())
    }

    fn store(&self, token: &str) -> Result<(), KeychainError> {
        self.check()?;
        *self.slot.lock().unwrap() = Some(token.to_owned());
        Ok(())
    }

    fn clear(&self) -> Result<(), KeychainError> {
        self.check()?;
        *self.slot.lock().unwrap() = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_mode_round_trips_without_the_os_and_can_be_switched_on() {
        let k = SwitchKeychain::new(true);
        assert_eq!(k.load().unwrap(), None);
        k.store("r1").unwrap();
        assert_eq!(k.load().unwrap().as_deref(), Some("r1"));
        k.clear().unwrap();
        assert_eq!(k.load().unwrap(), None);

        let k = SwitchKeychain::new(false);
        k.use_memory();
        k.store("r2").unwrap();
        assert_eq!(k.load().unwrap().as_deref(), Some("r2"));
    }
}
