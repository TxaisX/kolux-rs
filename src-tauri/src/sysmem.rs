// How much memory this process holds right now (its working set), for the status bar. Read
// straight from the OS: no crate needed on Windows or Linux; macOS reports unknown for now.

/// Bytes of the current process's working set, or `None` where it cannot be read.
pub fn working_set_bytes() -> Option<u64> {
    imp::working_set_bytes()
}

#[cfg(windows)]
mod imp {
    #[repr(C)]
    #[allow(non_snake_case)]
    struct ProcessMemoryCounters {
        cb: u32,
        PageFaultCount: u32,
        PeakWorkingSetSize: usize,
        WorkingSetSize: usize,
        QuotaPeakPagedPoolUsage: usize,
        QuotaPagedPoolUsage: usize,
        QuotaPeakNonPagedPoolUsage: usize,
        QuotaNonPagedPoolUsage: usize,
        PagefileUsage: usize,
        PeakPagefileUsage: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn K32GetProcessMemoryInfo(process: isize, counters: *mut ProcessMemoryCounters, cb: u32) -> i32;
    }

    pub fn working_set_bytes() -> Option<u64> {
        let mut c = ProcessMemoryCounters {
            cb: std::mem::size_of::<ProcessMemoryCounters>() as u32,
            PageFaultCount: 0,
            PeakWorkingSetSize: 0,
            WorkingSetSize: 0,
            QuotaPeakPagedPoolUsage: 0,
            QuotaPagedPoolUsage: 0,
            QuotaPeakNonPagedPoolUsage: 0,
            QuotaNonPagedPoolUsage: 0,
            PagefileUsage: 0,
            PeakPagefileUsage: 0,
        };
        // SAFETY: the pseudo-handle from GetCurrentProcess is always valid, the struct matches the
        // Win32 layout and `cb` carries its size, so the call writes only inside `c`.
        let ok = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut c, c.cb) };
        (ok != 0).then_some(c.WorkingSetSize as u64)
    }
}

#[cfg(target_os = "linux")]
mod imp {
    pub fn working_set_bytes() -> Option<u64> {
        // /proc/self/statm: size resident shared ... in pages.
        let text = std::fs::read_to_string("/proc/self/statm").ok()?;
        let resident: u64 = text.split_whitespace().nth(1)?.parse().ok()?;
        Some(resident * 4096)
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod imp {
    pub fn working_set_bytes() -> Option<u64> {
        None
    }
}

#[tauri::command]
pub fn process_memory() -> Option<u64> {
    working_set_bytes()
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(any(windows, target_os = "linux"))]
    fn a_running_test_holds_at_least_a_megabyte() {
        let bytes = super::working_set_bytes().expect("working set readable");
        assert!(bytes > 1024 * 1024, "{bytes} bytes");
    }
}
