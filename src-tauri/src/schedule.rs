//! Automation timetables (AUTO-001): the presets, a five-field cron line or an RRULE, worked out
//! in the IANA timezone saved with the automation. One implementation serves the dialog's preview,
//! the check on save and the clock, so all three always agree.
//! ponytail: RRULE lines with INTERVAL, COUNT, UNTIL, BYSETPOS, DTSTART or numbered weekdays
//! (`1MO`) are refused when saving; they are T-085-b's.
use jiff::civil::Date;
use jiff::tz::TimeZone;
use jiff::Timestamp;

/// A timetable line longer than this is refused when saving.
pub const MAX_LINE: usize = 200;
/// How far ahead an upcoming run is looked for: past one leap year to the next (2096 to 2104 has
/// no 29 February, so eight years and a bit). Nothing in that span means it can never come true.
const SEARCH_DAYS: i32 = 366 * 8 + 2;

/// The minutes, hours, days, months and weekdays a timetable allows. A day field that covers every
/// value counts as no limit (AUTO-001), so only the other day field narrows the runs.
#[derive(Debug, PartialEq)]
pub struct Spec {
    minutes: u64,
    hours: u32,
    days: u32,
    months: u16,
    weekdays: u8,
    days_all: bool,
    weekdays_all: bool,
}

fn bits(lo: u32, hi: u32) -> u64 {
    (lo..=hi).fold(0, |b, i| b | 1 << i)
}

const MONTHS: [&str; 12] = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS: [&str; 7] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
pub const DAY_NAMES: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/// One cron field: `*`, `5`, `1-5`, `*/15`, `10-40/10`, lists of those, and month or day names.
fn field(text: &str, what: &str, lo: u32, hi: u32, names: &[&str], name_base: u32) -> Result<u64, String> {
    let value = |s: &str| -> Result<u32, String> {
        let up = s.to_ascii_uppercase();
        if let Some(i) = names.iter().position(|n| *n == up) {
            return Ok(i as u32 + name_base);
        }
        let n: u32 = s.parse().map_err(|_| format!("the {what} field has \"{s}\", which is not a number"))?;
        if n < lo || n > hi {
            return Err(format!("the {what} field has {n}; it takes {lo} to {hi}"));
        }
        Ok(n)
    };
    let mut out = 0;
    for part in text.split(',') {
        let (range, step) = match part.split_once('/') {
            Some((r, s)) => (r, s.parse::<u32>().ok().filter(|s| *s > 0).ok_or_else(|| format!("the {what} field has a step \"{s}\" that is not a whole number above 0"))?),
            None => (part, 1),
        };
        let (a, b) = match range {
            "*" => (lo, hi),
            _ => match range.split_once('-') {
                Some((a, b)) => (value(a)?, value(b)?),
                None if step > 1 => (value(range)?, hi),
                None => {
                    let v = value(range)?;
                    (v, v)
                }
            },
        };
        if a > b {
            return Err(format!("the {what} field has the range {range}, which runs backwards"));
        }
        out |= (a..=b).step_by(step as usize).fold(0, |m, i| m | 1 << i);
    }
    Ok(out)
}

fn cron(line: &str) -> Result<Spec, String> {
    let f: Vec<&str> = line.split_whitespace().collect();
    if f.len() != 5 {
        return Err(format!("a cron line has five fields (minute hour day month weekday); this one has {}", f.len()));
    }
    let days = field(f[2], "day of month", 1, 31, &[], 0)?;
    // Weekday 7 is Sunday too.
    let wd = field(f[4], "weekday", 0, 7, &DAYS, 0)?;
    let weekdays = ((wd | (wd >> 7)) & 0x7f) as u8;
    Ok(Spec {
        minutes: field(f[0], "minute", 0, 59, &[], 0)?,
        hours: field(f[1], "hour", 0, 23, &[], 0)? as u32,
        days: days as u32,
        months: field(f[3], "month", 1, 12, &MONTHS, 1)? as u16,
        weekdays,
        days_all: days == bits(1, 31),
        weekdays_all: weekdays == 0x7f,
    })
}

/// An RRULE as the same five fields: FREQ with BYMINUTE, BYHOUR, BYDAY, BYMONTHDAY and BYMONTH.
/// A time part the rule leaves out is taken as 0 (there is no DTSTART to take it from).
fn rrule(line: &str) -> Result<Spec, String> {
    let body = line.trim().trim_start_matches("RRULE:").trim_start_matches("rrule:");
    let mut freq = None;
    let (mut minute, mut hour, mut day, mut month, mut weekday) = (None, None, None, None, None);
    for pair in body.split(';').filter(|p| !p.trim().is_empty()) {
        let (k, v) = pair.split_once('=').ok_or_else(|| format!("\"{pair}\" in the RRULE has no ="))?;
        let v = v.trim().to_string();
        match k.trim().to_ascii_uppercase().as_str() {
            "FREQ" => freq = Some(v.to_ascii_uppercase()),
            "BYMINUTE" => minute = Some(v),
            "BYHOUR" => hour = Some(v),
            "BYMONTHDAY" => day = Some(v),
            "BYMONTH" => month = Some(v),
            "BYDAY" => {
                let names: Result<Vec<String>, String> = v
                    .split(',')
                    .map(|d| ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].iter().position(|n| n.eq_ignore_ascii_case(d.trim())).map(|i| i.to_string()).ok_or_else(|| format!("BYDAY has \"{d}\"; use SU, MO, TU, WE, TH, FR or SA")))
                    .collect();
                weekday = Some(names?.join(","));
            }
            "INTERVAL" if v == "1" => {}
            "WKST" => {}
            other => return Err(format!("{other} in an RRULE is not supported yet; use a cron line or FREQ with BYMINUTE, BYHOUR, BYDAY, BYMONTHDAY and BYMONTH")),
        }
    }
    let star = || "*".to_string();
    let zero = || "0".to_string();
    let (mi, h, d, m, w) = match freq.as_deref() {
        Some("HOURLY") => (minute.unwrap_or_else(zero), hour.unwrap_or_else(star), day.unwrap_or_else(star), month.unwrap_or_else(star), weekday.unwrap_or_else(star)),
        Some("DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY") => (minute.unwrap_or_else(zero), hour.unwrap_or_else(zero), day.unwrap_or_else(star), month.unwrap_or_else(star), weekday.unwrap_or_else(star)),
        Some(f) => return Err(format!("FREQ={f} is not supported; use HOURLY, DAILY, WEEKLY, MONTHLY or YEARLY")),
        None => return Err("an RRULE needs FREQ, for example FREQ=WEEKLY;BYDAY=MO;BYHOUR=9".into()),
    };
    if freq.as_deref() == Some("WEEKLY") && w == "*" {
        return Err("a weekly RRULE needs BYDAY (there is no DTSTART to take the day from)".into());
    }
    if freq.as_deref() == Some("MONTHLY") && d == "*" && w == "*" {
        return Err("a monthly RRULE needs BYMONTHDAY or BYDAY".into());
    }
    if freq.as_deref() == Some("YEARLY") && (m == "*" || (d == "*" && w == "*")) {
        return Err("a yearly RRULE needs BYMONTH and BYMONTHDAY or BYDAY".into());
    }
    cron(&format!("{mi} {h} {d} {m} {w}"))
}

/// Tabs and runs of spaces inside a pasted line are plain separators.
pub fn normalize(line: &str) -> String {
    line.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn parse(line: &str) -> Result<Spec, String> {
    let line = normalize(line);
    if line.is_empty() {
        return Err("write a timetable: a cron line such as 0 9 * * 1-5, or an RRULE".into());
    }
    if line.len() > MAX_LINE {
        return Err(format!("the timetable is {} characters; at most {MAX_LINE}", line.len()));
    }
    if line.to_ascii_uppercase().contains("FREQ=") {
        rrule(&line)
    } else {
        cron(&line)
    }
}

pub fn zone(name: &str) -> Result<TimeZone, String> {
    TimeZone::get(name.trim()).map_err(|_| format!("\"{name}\" is not an IANA timezone name such as Europe/London"))
}

impl Spec {
    fn day_ok(&self, d: Date) -> bool {
        let dom = self.days & (1 << d.day()) != 0;
        let dow = self.weekdays & (1 << d.weekday().to_sunday_zero_offset()) != 0;
        match (self.days_all, self.weekdays_all) {
            (true, true) => true,
            (true, false) => dow,
            (false, true) => dom,
            (false, false) => dom || dow,
        }
    }

    /// The first due moment strictly after `after_ms`, in milliseconds, or none in the next
    /// eight years. A clock time that a daylight-saving jump skips runs just after the jump.
    pub fn next_after(&self, after_ms: i64, tz: &TimeZone) -> Option<i64> {
        let after = Timestamp::from_millisecond(after_ms).ok()?;
        let mut day = after.to_zoned(tz.clone()).date();
        for _ in 0..SEARCH_DAYS {
            if self.months & (1 << day.month()) != 0 && self.day_ok(day) {
                for h in (0..24).filter(|h| self.hours & (1 << h) != 0) {
                    for m in (0..60).filter(|m| self.minutes & (1u64 << m) != 0) {
                        let at = day.at(h as i8, m as i8, 0, 0).to_zoned(tz.clone()).ok()?.timestamp();
                        if at > after {
                            return Some(at.as_millisecond());
                        }
                    }
                }
            }
            day = day.tomorrow().ok()?;
        }
        None
    }
}

/// The presets as their cron lines: the hourly one at the chosen minute, the others at the
/// chosen clock time (`HH:MM`), weekly on `day` (0 is Sunday).
pub fn preset_line(preset: &str, time: &str, day: Option<u8>) -> Result<String, String> {
    let (h, m) = time.trim().split_once(':').and_then(|(h, m)| Some((h.parse::<u8>().ok().filter(|h| *h < 24)?, m.parse::<u8>().ok().filter(|m| *m < 60)?))).ok_or_else(|| format!("\"{time}\" is not a time; use HH:MM, for example 09:00"))?;
    Ok(match preset {
        "hourly" => format!("{m} * * * *"),
        "daily" => format!("{m} {h} * * *"),
        "weekdays" => format!("{m} {h} * * 1-5"),
        "weekly" => format!("{m} {h} * * {}", day.filter(|d| *d < 7).ok_or("pick the day of the week")?),
        other => return Err(format!("{other} is not a timetable; use hourly, daily, weekdays, weekly or custom")),
    })
}

/// Which preset a line is, with its time and day, or none when it is custom.
pub fn classify(line: &str) -> Option<(&'static str, String, Option<u8>)> {
    let line = normalize(line);
    let f: Vec<&str> = line.split(' ').collect();
    let num = |s: &str, hi: u8| s.parse::<u8>().ok().filter(|n| *n <= hi && n.to_string() == s);
    if f.len() != 5 || f[2] != "*" || f[3] != "*" {
        return None;
    }
    let m = num(f[0], 59)?;
    if f[1] == "*" {
        return (f[4] == "*").then(|| ("hourly", format!("00:{m:02}"), None));
    }
    let time = format!("{:02}:{m:02}", num(f[1], 23)?);
    match f[4] {
        "*" => Some(("daily", time, None)),
        "1-5" => Some(("weekdays", time, None)),
        d => num(d, 7).map(|d| ("weekly", time, Some(d % 7))),
    }
}

/// The timetable in a sentence that reads the same on every machine (no locale formats).
pub fn describe(line: &str, tz: &str) -> String {
    let at = match classify(line) {
        Some(("hourly", t, _)) => format!("Every hour at :{}", &t[3..]),
        Some(("daily", t, _)) => format!("Every day at {t}"),
        Some(("weekdays", t, _)) => format!("Monday to Friday at {t}"),
        Some((_, t, Some(d))) => format!("Every {} at {t}", DAY_NAMES[d as usize]),
        _ => match parse(line) {
            Ok(_) => format!("Custom: {}", normalize(line)),
            Err(_) => return "Timetable not readable".into(),
        },
    };
    if tz.trim().is_empty() {
        at
    } else {
        format!("{at} ({})", tz.trim())
    }
}

/// When an upcoming run is, in the automation's zone: "Monday 09:00" within a week, else
/// "29 Feb 2028 00:00". Fixed English words, so it reads the same whatever the locale.
pub fn when(ms: i64, now_ms: i64, tz: &TimeZone) -> String {
    let Ok(t) = Timestamp::from_millisecond(ms) else { return String::new() };
    let z = t.to_zoned(tz.clone());
    let clock = format!("{:02}:{:02}", z.hour(), z.minute());
    let today = Timestamp::from_millisecond(now_ms).map(|n| n.to_zoned(tz.clone()).date()).ok();
    let days = today.and_then(|d| d.until(z.date()).ok()).map(|s| s.get_days()).unwrap_or(i32::MAX);
    match days {
        0 => format!("Today {clock}"),
        1 => format!("Tomorrow {clock}"),
        2..=6 => format!("{} {clock}", DAY_NAMES[z.date().weekday().to_sunday_zero_offset() as usize]),
        _ => format!("{} {} {} {clock}", z.day(), ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][z.month() as usize - 1], z.year()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(tz: &str, y: i16, mo: i8, d: i8, h: i8, mi: i8) -> i64 {
        jiff::civil::date(y, mo, d).at(h, mi, 0, 0).to_zoned(zone(tz).unwrap()).unwrap().timestamp().as_millisecond()
    }
    fn next(line: &str, tz: &str, after: i64) -> Option<i64> {
        parse(line).unwrap().next_after(after, &zone(tz).unwrap())
    }

    #[test]
    fn a_weekday_timetable_saved_on_a_friday_afternoon_next_runs_monday_morning() {
        let line = preset_line("weekdays", "09:00", None).unwrap();
        assert_eq!(line, "0 9 * * 1-5");
        // Friday 9 October 2026, 15:30 in Chicago.
        let friday = ms("America/Chicago", 2026, 10, 9, 15, 30);
        let due = next(&line, "America/Chicago", friday).unwrap();
        assert_eq!(due, ms("America/Chicago", 2026, 10, 12, 9, 0));
        assert_eq!(when(due, friday, &zone("America/Chicago").unwrap()), "Monday 09:00");
        // The same moment is a different wall clock in another zone.
        assert_eq!(next(&line, "Asia/Tokyo", friday).unwrap(), ms("Asia/Tokyo", 2026, 10, 12, 9, 0));
    }

    #[test]
    fn bad_lines_are_refused_with_a_reason() {
        assert!(parse("61 * * * *").unwrap_err().contains("minute field has 61"));
        assert!(parse("0 9 * *").unwrap_err().contains("five fields"));
        assert!(parse(&"1,".repeat(120)).unwrap_err().contains("at most"));
        assert!(parse("0 9 * * 5-1").unwrap_err().contains("backwards"));
        assert!(parse("*/0 * * * *").unwrap_err().contains("step"));
        assert!(parse("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO").unwrap_err().contains("INTERVAL"));
        // Can never come true: 31 February.
        assert_eq!(next("0 0 31 2 *", "UTC", ms("UTC", 2026, 1, 1, 0, 0)), None);
    }

    #[test]
    fn a_line_that_only_matches_29_february_finds_the_next_leap_year() {
        let after = ms("UTC", 2026, 10, 9, 12, 0);
        assert_eq!(next("0 0 29 2 *", "UTC", after), Some(ms("UTC", 2028, 2, 29, 0, 0)));
        assert_eq!(next("0 0 29 2 *", "UTC", ms("UTC", 2097, 1, 1, 0, 0)), Some(ms("UTC", 2104, 2, 29, 0, 0)));
    }

    #[test]
    fn day_fields_spaces_sunday_seven_and_presets() {
        let after = ms("UTC", 2026, 10, 9, 12, 0); // a Friday
        // */1 in the day of month covers every day: only the weekday narrows (Sunday as 7).
        assert_eq!(next("0 8 */1 * 7", "UTC", after), Some(ms("UTC", 2026, 10, 11, 8, 0)));
        // Both day fields narrowed: either one will do (the 13th, or a Monday).
        assert_eq!(next("0 8 13 * 1", "UTC", after), Some(ms("UTC", 2026, 10, 12, 8, 0)));
        assert_eq!(normalize(" 0\t9  * *\t1-5 "), "0 9 * * 1-5");
        assert_eq!(classify("0\t9 * * 1-5"), Some(("weekdays", "09:00".into(), None)));
        assert_eq!(classify("15 * * * *"), Some(("hourly", "00:15".into(), None)));
        assert_eq!(classify("0 9 * * 7"), Some(("weekly", "09:00".into(), Some(0))));
        assert_eq!(classify("0 9 1 * *"), None);
        assert_eq!(describe("30 7 * * 1", "Europe/Paris"), "Every Monday at 07:30 (Europe/Paris)");
        assert_eq!(describe("0 9 1 * *", ""), "Custom: 0 9 1 * *");
        assert_eq!(describe("nonsense", ""), "Timetable not readable");
        assert_eq!(next("FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=9;BYMINUTE=30", "UTC", after), Some(ms("UTC", 2026, 10, 12, 9, 30)));
        assert_eq!(next("0 9 * JAN MON", "UTC", after), Some(ms("UTC", 2027, 1, 4, 9, 0)));
        assert!(zone("Mars/Olympus").is_err());
    }

    #[test]
    fn a_clock_time_skipped_by_daylight_saving_still_runs() {
        // 02:30 does not exist in New York on 8 March 2026.
        let after = ms("America/New_York", 2026, 3, 7, 12, 0);
        let due = next("30 2 * * *", "America/New_York", after).unwrap();
        assert!(due > ms("America/New_York", 2026, 3, 8, 1, 59) && due < ms("America/New_York", 2026, 3, 8, 4, 0));
    }
}
