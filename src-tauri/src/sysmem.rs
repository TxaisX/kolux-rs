// How much memory this process holds right now (its working set), for the status bar. Read
// straight from the OS: no crate needed on Windows or Linux; macOS reports unknown for now.

/// Bytes of the current process's working set, or `None` where it cannot be read.
pub fn working_set_bytes() -> Option<u64> {
    imp::working_set_bytes()
}

/// Bytes of physical memory the machine has, or `None` where it cannot be read (APP-022).
pub fn total_ram_bytes() -> Option<u64> {
    imp::total_ram_bytes()
}

/// `MemTotal` of /proc/meminfo, in bytes.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn meminfo_total(text: &str) -> Option<u64> {
    let line = text.lines().find(|l| l.starts_with("MemTotal:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    kb.checked_mul(1024)
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

    #[repr(C)]
    #[allow(non_snake_case)]
    struct MemoryStatusEx {
        dwLength: u32,
        dwMemoryLoad: u32,
        ullTotalPhys: u64,
        ullAvailPhys: u64,
        ullTotalPageFile: u64,
        ullAvailPageFile: u64,
        ullTotalVirtual: u64,
        ullAvailVirtual: u64,
        ullAvailExtendedVirtual: u64,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
    }

    pub fn total_ram_bytes() -> Option<u64> {
        let mut m = MemoryStatusEx {
            dwLength: std::mem::size_of::<MemoryStatusEx>() as u32,
            dwMemoryLoad: 0,
            ullTotalPhys: 0,
            ullAvailPhys: 0,
            ullTotalPageFile: 0,
            ullAvailPageFile: 0,
            ullTotalVirtual: 0,
            ullAvailVirtual: 0,
            ullAvailExtendedVirtual: 0,
        };
        // SAFETY: the struct matches the Win32 layout and dwLength carries its size.
        let ok = unsafe { GlobalMemoryStatusEx(&mut m) };
        (ok != 0 && m.ullTotalPhys > 0).then_some(m.ullTotalPhys)
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

    pub fn total_ram_bytes() -> Option<u64> {
        super::meminfo_total(&std::fs::read_to_string("/proc/meminfo").ok()?)
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod imp {
    pub fn working_set_bytes() -> Option<u64> {
        None
    }

    pub fn total_ram_bytes() -> Option<u64> {
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
    fn app022_meminfo_total_is_read_in_bytes() {
        assert_eq!(super::meminfo_total("MemFree: 5 kB
MemTotal:       16384 kB
"), Some(16384 * 1024));
        assert_eq!(super::meminfo_total("MemFree: 5 kB
"), None);
        assert_eq!(super::meminfo_total("MemTotal: lots kB
"), None);
    }

    #[test]
    #[cfg(any(windows, target_os = "linux"))]
    fn app022_this_machine_reports_some_ram() {
        assert!(super::total_ram_bytes().expect("ram readable") >= 256 * 1024 * 1024);
    }

    #[test]
    #[cfg(any(windows, target_os = "linux"))]
    fn a_running_test_holds_at_least_a_megabyte() {
        let bytes = super::working_set_bytes().expect("working set readable");
        assert!(bytes > 1024 * 1024, "{bytes} bytes");
    }
}
