//! Tests only: a throwaway folder in the temp folder, removed when the test lets go of it (a test
//! that opens a store in it drops the store first, so Windows lets the folder go).

use std::path::PathBuf;

pub struct TempDir(pub PathBuf);

impl std::ops::Deref for TempDir {
    type Target = PathBuf;
    fn deref(&self) -> &PathBuf {
        &self.0
    }
}

impl Drop for TempDir {
    /// Tried a few times: on Windows a file just closed (a store's database) can stay held for a
    /// moment by the system, and a test run under load left whole folders behind.
    fn drop(&mut self) {
        for _ in 0..10 {
            if std::fs::remove_dir_all(&self.0).is_ok() || !self.0.exists() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}

/// An empty `kolux-<tag>-<process id>` folder.
pub fn temp(tag: &str) -> TempDir {
    let d = std::env::temp_dir().join(format!("kolux-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    TempDir(d)
}
