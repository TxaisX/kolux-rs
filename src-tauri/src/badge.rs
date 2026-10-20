//! STAT-048 / T-125: the app badge counts the workspaces with agent results not yet seen. The window
//! sends the count (badge_set); zero clears the badge; a failure to set or clear it is ignored.
//! Windows has no badge count, only a taskbar overlay icon, so the count is drawn into a small
//! amber disc (one digit up to 9, a plain disc above); macOS and Linux docks take the number.
// Nothing calls this until the lib.rs patch registers badge_set.
#![allow(dead_code)]

/// Counts above this read the same (the window caps them too).
pub const CAP: u32 = 99;
pub const SIZE: u32 = 16;
const AMBER: [u8; 4] = [0xF5, 0xA5, 0x24, 0xFF];
const INK: [u8; 4] = [0x1A, 0x12, 0x00, 0xFF];

/// A 3x5 bitmap per digit, one row per byte, high bit first.
const DIGITS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111],
    [0b010, 0b110, 0b010, 0b010, 0b111],
    [0b111, 0b001, 0b111, 0b100, 0b111],
    [0b111, 0b001, 0b111, 0b001, 0b111],
    [0b101, 0b101, 0b111, 0b001, 0b001],
    [0b111, 0b100, 0b111, 0b001, 0b111],
    [0b111, 0b100, 0b111, 0b101, 0b111],
    [0b111, 0b001, 0b001, 0b001, 0b001],
    [0b111, 0b101, 0b111, 0b101, 0b111],
    [0b111, 0b101, 0b111, 0b001, 0b111],
];

/// The count the badge shows: zero clears, large counts are capped.
pub fn shown(count: u32) -> Option<u32> {
    (count > 0).then_some(count.min(CAP))
}

/// The overlay image for Windows: SIZE x SIZE RGBA, an amber disc with the digit when it is one.
pub fn overlay_rgba(count: u32) -> Vec<u8> {
    let s = SIZE as i32;
    let mut px = vec![0u8; (SIZE * SIZE * 4) as usize];
    let c = (s - 1) as f32 / 2.0;
    let r = s as f32 / 2.0;
    for y in 0..s {
        for x in 0..s {
            let (dx, dy) = (x as f32 - c, y as f32 - c);
            if dx * dx + dy * dy <= r * r {
                let i = ((y * s + x) * 4) as usize;
                px[i..i + 4].copy_from_slice(&AMBER);
            }
        }
    }
    // ponytail: one digit only; two digits at 16px are unreadable, the disc alone says "some".
    if (1..=9).contains(&count) {
        let glyph = DIGITS[count as usize];
        let (x0, y0) = ((s - 6) / 2, (s - 10) / 2); // 3x5 drawn at 2x
        for (row, bits) in glyph.iter().enumerate() {
            for col in 0..3 {
                if bits & (0b100 >> col) == 0 {
                    continue;
                }
                for (dy, dx) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                    let (x, y) = (x0 + col * 2 + dx, y0 + row as i32 * 2 + dy);
                    let i = ((y * s + x) * 4) as usize;
                    px[i..i + 4].copy_from_slice(&INK);
                }
            }
        }
    }
    px
}

/// Puts the count on the window's taskbar or dock entry; any failure is ignored (STAT-048).
#[tauri::command]
pub fn badge_set(window: tauri::WebviewWindow, count: u32) {
    let shown = shown(count);
    #[cfg(windows)]
    {
        let icon = shown.map(|n| tauri::image::Image::new_owned(overlay_rgba(n), SIZE, SIZE));
        let _ = window.set_overlay_icon(icon);
    }
    #[cfg(not(windows))]
    {
        let _ = window.set_badge_count(shown.map(i64::from));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(px: &[u8], x: u32, y: u32) -> [u8; 4] {
        let i = ((y * SIZE + x) * 4) as usize;
        px[i..i + 4].try_into().unwrap()
    }

    #[test]
    fn stat048_zero_clears_and_large_counts_are_capped() {
        assert_eq!(shown(0), None);
        assert_eq!(shown(1), Some(1));
        assert_eq!(shown(2), Some(2));
        assert_eq!(shown(1_000), Some(CAP));
    }

    #[test]
    fn stat048_the_overlay_is_an_amber_disc_with_the_digit_and_clear_corners() {
        let two = overlay_rgba(2);
        assert_eq!(two.len(), (SIZE * SIZE * 4) as usize);
        assert_eq!(pixel(&two, 0, 0), [0, 0, 0, 0], "the corners stay transparent");
        assert_eq!(pixel(&two, 1, SIZE / 2), AMBER, "the disc reaches the edge on the middle row");
        assert!(two.chunks(4).any(|p| p == INK), "the digit is drawn");
        let twelve = overlay_rgba(12);
        assert!(!twelve.chunks(4).any(|p| p == INK), "two digits fall back to the plain disc");
        assert_ne!(overlay_rgba(1), two, "each digit draws differently");
    }
}
