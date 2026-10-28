//! Holds a batch oplock on one file and never acknowledges the break, so any other open of that file blocks
//! (until Windows gives up waiting, about 35 s). Used by scripts/prove/live-APP-050.mjs to stall a "profile drive".
//!
//! usage: oplock-hold <file> [hold-seconds]   prints GRANTED once the oplock is held, BROKEN <ms> when another open arrives.
use std::io::Write;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_IO_PENDING, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
use windows_sys::Win32::Storage::FileSystem::{CreateFileW, FILE_FLAG_OVERLAPPED, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING};
use windows_sys::Win32::System::IO::{DeviceIoControl, OVERLAPPED};
use windows_sys::Win32::System::Ioctl::FSCTL_REQUEST_BATCH_OPLOCK;
use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

const GENERIC_READ: u32 = 0x8000_0000;

fn say(line: &str) {
    println!("{line}");
    let _ = std::io::stdout().flush();
}

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        eprintln!("usage: oplock-hold <file> [hold-seconds]");
        std::process::exit(2);
    };
    let hold: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(120);
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: plain Win32 calls on handles and buffers owned by this function; the OVERLAPPED outlives the pending request.
    unsafe {
        let file = CreateFileW(wide.as_ptr(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, std::ptr::null(), OPEN_EXISTING, FILE_FLAG_OVERLAPPED, std::ptr::null_mut());
        if file == INVALID_HANDLE_VALUE {
            say(&format!("OPEN-FAILED {}", GetLastError()));
            std::process::exit(3);
        }
        let event = CreateEventW(std::ptr::null(), 1, 0, std::ptr::null());
        let mut ov: Box<OVERLAPPED> = Box::new(std::mem::zeroed());
        ov.hEvent = event;
        let mut got = 0u32;
        let ok = DeviceIoControl(file, FSCTL_REQUEST_BATCH_OPLOCK, std::ptr::null(), 0, std::ptr::null_mut(), 0, &mut got, &mut *ov);
        let err = GetLastError();
        if ok != 0 || err != ERROR_IO_PENDING {
            say(&format!("NOT-GRANTED ok={ok} error={err}"));
            CloseHandle(file);
            std::process::exit(4);
        }
        say("GRANTED");
        let started = Instant::now();
        let r = WaitForSingleObject(event, (hold * 1000).min(u32::MAX as u64 - 1) as u32);
        if r == WAIT_OBJECT_0 {
            say(&format!("BROKEN {}", started.elapsed().as_millis()));
            // Never acknowledged: keep the handle for the rest of the hold time.
            let left = Duration::from_secs(hold).saturating_sub(started.elapsed());
            std::thread::sleep(left);
        }
        say(&format!("EXIT after {} ms", started.elapsed().as_millis()));
        CloseHandle(file);
    }
}
