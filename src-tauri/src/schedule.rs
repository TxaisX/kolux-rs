//! Automation timetables (AUTO-001): the presets, a five-field cron line or an RRULE, worked out
//! in the IANA timezone saved with the automation. One implementation serves the dialog's preview,
//! the check on save and the clock, so all three always agree.
//! An RRULE with INTERVAL, COUNT, UNTIL, BYSETPOS, DTSTART or numbered weekdays (`1MO`, `-1FR`)
//! is walked period by period from its DTSTART (T-085-c); a plain one is the five fields.
//! ponytail: no BYYEARDAY, BYWEEKNO or BYSECOND; add them when a pasted rule needs one.
use jiff::civil::{Date, DateTime};
use jiff::tz::TimeZone;
use jiff::{Span, Timestamp};

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
    /// T-085-c: an RRULE the five fields cannot hold.
    rule: Option<Box<Rule>>,
}

/// How many periods an RRULE is walked through before it counts as never coming true.
const MAX_PERIODS: usize = 200_000;
const DAY_CODES: [&str; 7] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

#[derive(Debug, Clone, Copy, PartialEq)]
enum Freq {
    Hourly,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

/// A DTSTART or UNTIL: a wall-clock time in the automation's zone, or a fixed moment (`Z` or TZID).
#[derive(Debug, Clone, Copy, PartialEq)]
enum When {
    Wall(DateTime),
    At(Timestamp),
}

impl When {
    fn wall(self, tz: &TimeZone) -> DateTime {
        match self {
            When::Wall(d) => d,
            When::At(t) => t.to_zoned(tz.clone()).datetime(),
        }
    }
}

/// An RRULE as written: the five-field parts as text, the rest as values.
#[derive(Debug, PartialEq)]
struct Rule {
    freq: Freq,
    minute: Option<String>,
    hour: Option<String>,
    day: Option<String>,
    month: Option<String>,
    weekday: Option<String>,
    /// Numbered weekdays: (n, weekday from Sunday = 0); a negative n counts from the end.
    nth: Vec<(i8, i8)>,
    interval: u32,
    count: Option<u32>,
    until: Option<When>,
    setpos: Vec<i32>,
    start: Option<When>,
    wkst: i8,
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
        rule: None,
    })
}

/// A DTSTART or UNTIL value: `20261013T090000` (wall clock), with `Z` for UTC or a TZID, or a
/// date `20261013` (an UNTIL date takes in the whole day).
fn moment(v: &str, tzid: Option<&str>, end_of_day: bool, what: &str) -> Result<When, String> {
    let bad = || format!("{what} has \"{v}\"; write it as 20261013T090000, with Z for UTC, or as a date 20261013");
    let (body, utc) = match v.strip_suffix(['Z', 'z']) {
        Some(b) => (b, true),
        None => (v, false),
    };
    let num = |from: usize, to: usize| body.get(from..to).filter(|t| t.bytes().all(|c| c.is_ascii_digit())).and_then(|t| t.parse::<i16>().ok()).ok_or_else(bad);
    let (y, mo, d) = (num(0, 4)?, num(4, 6)? as i8, num(6, 8)? as i8);
    let wall = match body.len() {
        8 if !utc => {
            let (h, mi, sec) = if end_of_day { (23, 59, 59) } else { (0, 0, 0) };
            DateTime::new(y, mo, d, h, mi, sec, 0)
        }
        15 if body.as_bytes()[8].eq_ignore_ascii_case(&b'T') => DateTime::new(y, mo, d, num(9, 11)? as i8, num(11, 13)? as i8, num(13, 15)? as i8, 0),
        _ => return Err(bad()),
    }
    .map_err(|_| bad())?;
    Ok(match (utc, tzid) {
        (true, _) => When::At(wall.to_zoned(TimeZone::UTC).map_err(|_| bad())?.timestamp()),
        (false, Some(name)) => When::At(wall.to_zoned(zone(name)?).map_err(|_| bad())?.timestamp()),
        (false, None) => When::Wall(wall),
    })
}

/// An RRULE, optionally after a `DTSTART:` (or `DTSTART;TZID=...:`) part. A plain rule (FREQ with
/// BYMINUTE, BYHOUR, BYDAY, BYMONTHDAY and BYMONTH) is the same five fields as a cron line; one
/// with INTERVAL, COUNT, UNTIL, BYSETPOS, DTSTART, numbered weekdays, or both BYMONTHDAY and BYDAY
/// (which must then both match) keeps its rule and is walked period by period.
fn rrule(line: &str) -> Result<Spec, String> {
    let mut start = None;
    let mut rest = Vec::new();
    for tok in line.split(' ') {
        let up = tok.to_ascii_uppercase();
        if up.starts_with("DTSTART;") || up.starts_with("DTSTART:") {
            let (head, v) = tok.split_once(':').ok_or_else(|| format!("\"{tok}\" has no value; write DTSTART:20261013T090000"))?;
            let tzid = head.split(';').skip(1).find_map(|p| p.split_once('=').filter(|(k, _)| k.eq_ignore_ascii_case("TZID")).map(|(_, v)| v));
            start = Some(moment(v, tzid, false, "DTSTART")?);
        } else {
            rest.push(if up.starts_with("RRULE:") { &tok[6..] } else { tok });
        }
    }
    let body = rest.join(";");
    let mut r = Rule { freq: Freq::Daily, minute: None, hour: None, day: None, month: None, weekday: None, nth: Vec::new(), interval: 1, count: None, until: None, setpos: Vec::new(), start, wkst: 1 };
    let mut freq = None;
    let day_code = |d: &str, what: &str| DAY_CODES.iter().position(|n| n.eq_ignore_ascii_case(d)).map(|i| i as i8).ok_or_else(|| format!("{what} has \"{d}\"; use SU, MO, TU, WE, TH, FR or SA"));
    for pair in body.split(';').filter(|p| !p.trim().is_empty()) {
        let (k, v) = pair.split_once('=').ok_or_else(|| format!("\"{pair}\" in the RRULE has no ="))?;
        let v = v.trim().to_string();
        let key = k.trim().to_ascii_uppercase();
        let number = |lo: i64, hi: i64| v.parse::<i64>().ok().filter(|n| (lo..=hi).contains(n)).ok_or_else(|| format!("{key}={v}: use a whole number from {lo} to {hi}"));
        match key.as_str() {
            "FREQ" => freq = Some(v.to_ascii_uppercase()),
            "BYMINUTE" => r.minute = Some(v),
            "BYHOUR" => r.hour = Some(v),
            "BYMONTHDAY" => r.day = Some(v),
            "BYMONTH" => r.month = Some(v),
            "BYDAY" => {
                let mut plain = Vec::new();
                for d in v.split(',').map(str::trim) {
                    let at = d.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(d.len());
                    let w = day_code(&d[at..], "BYDAY")?;
                    if at == 0 {
                        plain.push(w.to_string());
                    } else {
                        let n = d[..at].trim_start_matches('+').parse::<i8>().ok().filter(|n| *n != 0 && (-53..=53).contains(n)).ok_or_else(|| format!("BYDAY has \"{d}\"; a numbered weekday is 1MO to 53MO, or -1MO for the last"))?;
                        r.nth.push((n, w));
                    }
                }
                r.weekday = (!plain.is_empty()).then(|| plain.join(","));
            }
            "INTERVAL" => r.interval = number(1, 1000)? as u32,
            "COUNT" => r.count = Some(number(1, 100_000)? as u32),
            "UNTIL" => r.until = Some(moment(&v, None, true, "UNTIL")?),
            "DTSTART" => r.start = Some(moment(&v, None, false, "DTSTART")?),
            "BYSETPOS" => {
                r.setpos = v.split(',').map(|p| p.trim().parse::<i32>().ok().filter(|n| *n != 0 && (-366..=366).contains(n)).ok_or_else(|| format!("BYSETPOS has \"{p}\"; use 1 to 366, or -1 for the last"))).collect::<Result<_, _>>()?;
            }
            "WKST" => r.wkst = day_code(&v, "WKST")?,
            other => return Err(format!("{other} in an RRULE is not supported; use FREQ with INTERVAL, COUNT, UNTIL, BYMINUTE, BYHOUR, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS or WKST, and an optional DTSTART")),
        }
    }
    r.freq = match freq.as_deref() {
        Some("HOURLY") => Freq::Hourly,
        Some("DAILY") => Freq::Daily,
        Some("WEEKLY") => Freq::Weekly,
        Some("MONTHLY") => Freq::Monthly,
        Some("YEARLY") => Freq::Yearly,
        Some(f) => return Err(format!("FREQ={f} is not supported; use HOURLY, DAILY, WEEKLY, MONTHLY or YEARLY")),
        None => return Err("an RRULE needs FREQ, for example FREQ=WEEKLY;BYDAY=MO;BYHOUR=9".into()),
    };
    if r.start.is_none() && (r.interval > 1 || r.count.is_some()) {
        let what = if r.interval > 1 { format!("INTERVAL={}", r.interval) } else { "COUNT".into() };
        return Err(format!("{what} needs a DTSTART to count from; put DTSTART:20261013T090000 before the RRULE"));
    }
    if r.count.is_some() && r.until.is_some() {
        return Err("an RRULE has COUNT or UNTIL, not both".into());
    }
    if !r.nth.is_empty() && !matches!(r.freq, Freq::Monthly | Freq::Yearly) {
        return Err("a numbered weekday such as 1MO goes with FREQ=MONTHLY or FREQ=YEARLY".into());
    }
    let plain = r.interval == 1 && r.count.is_none() && r.until.is_none() && r.setpos.is_empty() && r.start.is_none() && r.nth.is_empty() && !(r.day.is_some() && r.weekday.is_some());
    let spec = r.five(r.start.map(|s| s.wall(&TimeZone::UTC)))?;
    Ok(if plain { spec } else { Spec { rule: Some(Box::new(r)), ..spec } })
}

impl Rule {
    /// The five fields this rule allows; a part it leaves out comes from DTSTART when it has one,
    /// else a time part is 0.
    fn five(&self, start: Option<DateTime>) -> Result<Spec, String> {
        let byday = self.weekday.is_some() || !self.nth.is_empty();
        let (sm, sh) = start.map_or(("0".to_string(), "0".to_string()), |t| (t.minute().to_string(), t.hour().to_string()));
        let mi = self.minute.clone().unwrap_or(sm);
        let h = self.hour.clone().unwrap_or(if self.freq == Freq::Hourly { "*".into() } else { sh });
        let (mut d, mut m, mut w) = (self.day.clone(), self.month.clone(), self.weekday.clone());
        match (self.freq, start) {
            (Freq::Weekly, Some(t)) if !byday => w = Some(t.date().weekday().to_sunday_zero_offset().to_string()),
            (Freq::Monthly, Some(t)) if !byday && d.is_none() => d = Some(t.day().to_string()),
            (Freq::Yearly, Some(t)) if !byday && d.is_none() => {
                d = Some(t.day().to_string());
                m = m.or_else(|| Some(t.month().to_string()));
            }
            (Freq::Weekly, None) if !byday => return Err("a weekly RRULE needs BYDAY, or a DTSTART to take the day from".into()),
            (Freq::Monthly, None) if !byday && d.is_none() => return Err("a monthly RRULE needs BYMONTHDAY or BYDAY, or a DTSTART".into()),
            (Freq::Yearly, None) if (m.is_none() && self.nth.is_empty()) || (!byday && d.is_none()) => return Err("a yearly RRULE needs BYMONTH and BYMONTHDAY or BYDAY, or a DTSTART".into()),
            _ => {}
        }
        let star = || "*".to_string();
        cron(&format!("{mi} {h} {} {} {}", d.unwrap_or_else(star), m.unwrap_or_else(star), w.unwrap_or_else(star)))
    }

    /// The start of the period holding `t`: its hour, day, week (from WKST), month or year.
    fn period_of(&self, t: DateTime) -> Option<DateTime> {
        let d = t.date();
        Some(match self.freq {
            Freq::Hourly => d.at(t.hour(), 0, 0, 0),
            Freq::Daily => d.at(0, 0, 0, 0),
            Freq::Weekly => d.checked_sub(Span::new().days(i64::from((d.weekday().to_sunday_zero_offset() - self.wkst + 7) % 7))).ok()?.at(0, 0, 0, 0),
            Freq::Monthly => d.first_of_month().at(0, 0, 0, 0),
            Freq::Yearly => Date::new(d.year(), 1, 1).ok()?.at(0, 0, 0, 0),
        })
    }

    fn step(&self, p: DateTime) -> Option<DateTime> {
        let n = i64::from(self.interval);
        let span = match self.freq {
            Freq::Hourly => Span::new().hours(n),
            Freq::Daily => Span::new().days(n),
            Freq::Weekly => Span::new().weeks(n),
            Freq::Monthly => Span::new().months(n),
            Freq::Yearly => Span::new().years(n),
        };
        p.checked_add(span).ok()
    }

    /// Is `d` the n-th weekday `w` of its month (of its year for a yearly rule with no BYMONTH)?
    fn nth_is(&self, d: Date, n: i8, w: i8) -> bool {
        if d.weekday().to_sunday_zero_offset() != w {
            return false;
        }
        let (pos, len) = if self.freq == Freq::Yearly && self.month.is_none() { (i32::from(d.day_of_year()), i32::from(d.days_in_year())) } else { (i32::from(d.day()), i32::from(d.days_in_month())) };
        let k = if n > 0 { (pos - 1) / 7 + 1 } else { -((len - pos) / 7 + 1) };
        k == i32::from(n)
    }

    /// Every part of the rule must match (RFC 5545), unlike cron's either-day-field rule.
    fn day_ok(&self, spec: &Spec, d: Date) -> bool {
        let month = spec.months & (1u16 << d.month()) != 0;
        let dom = spec.days_all || spec.days & (1u32 << d.day()) != 0;
        let dow = spec.weekdays & (1u8 << d.weekday().to_sunday_zero_offset()) != 0;
        let byday = (spec.weekdays_all && self.nth.is_empty()) || (!spec.weekdays_all && dow) || self.nth.iter().any(|&(n, w)| self.nth_is(d, n, w));
        month && dom && byday
    }

    /// The times one period yields, in order, after BYSETPOS has picked from them.
    fn picks(&self, spec: &Spec, p: DateTime) -> Vec<DateTime> {
        let d0 = p.date();
        let len = match self.freq {
            Freq::Hourly | Freq::Daily => 1,
            Freq::Weekly => 7,
            Freq::Monthly => i64::from(d0.days_in_month()),
            Freq::Yearly => i64::from(d0.days_in_year()),
        };
        let mut out = Vec::new();
        for d in (0..len).filter_map(|i| d0.checked_add(Span::new().days(i)).ok()).filter(|d| self.day_ok(spec, *d)) {
            for h in (0..24i8).filter(|h| spec.hours & (1u32 << h) != 0 && (self.freq != Freq::Hourly || *h == p.hour())) {
                for m in (0..60i8).filter(|m| spec.minutes & (1u64 << m) != 0) {
                    out.push(d.at(h, m, 0, 0));
                }
            }
        }
        if self.setpos.is_empty() {
            return out;
        }
        let n = out.len() as i32;
        let mut keep: Vec<DateTime> = self.setpos.iter().filter_map(|&k| Some(if k > 0 { k - 1 } else { n + k }).filter(|i| (0..n).contains(i)).map(|i| out[i as usize])).collect();
        keep.sort();
        keep.dedup();
        keep
    }

    /// Walks the periods from DTSTART's (or from `after`'s when there is none), counting every
    /// occurrence for COUNT, and returns the first one strictly after `after_ms`.
    fn next_after(&self, after_ms: i64, tz: &TimeZone) -> Option<i64> {
        let after = Timestamp::from_millisecond(after_ms).ok()?;
        let start = self.start.map(|s| s.wall(tz));
        let spec = self.five(start).ok()?;
        let until = self.until.map(|u| u.wall(tz));
        let now = after.to_zoned(tz.clone()).datetime();
        let horizon = now.date().checked_add(Span::new().days(SEARCH_DAYS)).ok()?;
        let mut period = self.period_of(start.unwrap_or(now))?;
        let mut seen = 0u32;
        for _ in 0..MAX_PERIODS {
            if period.date() > horizon {
                return None;
            }
            for t in self.picks(&spec, period) {
                if start.is_some_and(|s| t < s) {
                    continue;
                }
                if until.is_some_and(|u| t > u) {
                    return None;
                }
                seen += 1;
                if self.count.is_some_and(|n| seen > n) {
                    return None;
                }
                let at = t.to_zoned(tz.clone()).ok()?.timestamp();
                if at > after {
                    return Some(at.as_millisecond());
                }
            }
            period = self.step(period)?;
        }
        None
    }
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
        if let Some(r) = &self.rule {
            return r.next_after(after_ms, tz);
        }
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
    fn t085c_interval_count_until_and_dtstart_count_from_the_start() {
        let lon = "Europe/London";
        // Every second Monday from Monday 5 October 2026 at 09:00.
        let fortnight = "DTSTART:20261005T090000 RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO";
        assert_eq!(next(fortnight, lon, ms(lon, 2026, 10, 6, 0, 0)), Some(ms(lon, 2026, 10, 19, 9, 0)));
        assert_eq!(next(fortnight, lon, ms(lon, 2026, 10, 19, 9, 0)), Some(ms(lon, 2026, 11, 2, 9, 0)));
        // COUNT=3 from DTSTART: the third run is the last; the time comes from DTSTART.
        let three = "DTSTART:20261013T090000 RRULE:FREQ=DAILY;COUNT=3";
        assert_eq!(next(three, lon, ms(lon, 2026, 10, 14, 9, 0)), Some(ms(lon, 2026, 10, 15, 9, 0)));
        assert_eq!(next(three, lon, ms(lon, 2026, 10, 15, 9, 0)), None);
        // An UNTIL date takes in its whole day.
        let until = "FREQ=DAILY;BYHOUR=9;UNTIL=20261015";
        assert_eq!(next(until, lon, ms(lon, 2026, 10, 14, 10, 0)), Some(ms(lon, 2026, 10, 15, 9, 0)));
        assert_eq!(next(until, lon, ms(lon, 2026, 10, 15, 9, 0)), None);
        // A UTC DTSTART is 11:00 on a Tuesday in Chicago; the weekly day and time come from it.
        let chi = "America/Chicago";
        let z = "DTSTART:20261013T160000Z\nRRULE:FREQ=WEEKLY;COUNT=2";
        assert_eq!(next(z, chi, ms(chi, 2026, 10, 13, 12, 0)), Some(ms(chi, 2026, 10, 20, 11, 0)));
        assert_eq!(next(z, chi, ms(chi, 2026, 10, 20, 11, 0)), None);
        // A TZID start is that zone's wall clock: 09:00 in Tokyo is midnight UTC.
        let tokyo = "DTSTART;TZID=Asia/Tokyo:20261013T090000 RRULE:FREQ=DAILY;COUNT=2";
        assert_eq!(next(tokyo, "UTC", ms("UTC", 2026, 10, 13, 0, 0)), Some(ms("UTC", 2026, 10, 14, 0, 0)));
    }

    #[test]
    fn t085c_numbered_weekdays_setpos_and_both_day_parts() {
        let after = ms("UTC", 2026, 10, 13, 12, 0);
        // The last weekday of the month: Friday 30 October 2026.
        assert_eq!(next("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;BYHOUR=17", "UTC", after), Some(ms("UTC", 2026, 10, 30, 17, 0)));
        // The first Monday (2 November) and the last Friday (30 October).
        assert_eq!(next("FREQ=MONTHLY;BYDAY=1MO;BYHOUR=9", "UTC", after), Some(ms("UTC", 2026, 11, 2, 9, 0)));
        assert_eq!(next("FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=9", "UTC", after), Some(ms("UTC", 2026, 10, 30, 9, 0)));
        // The fourth Thursday of November, and the 20th Monday of the year (17 May 2027).
        assert_eq!(next("FREQ=YEARLY;BYMONTH=11;BYDAY=4TH;BYHOUR=9", "UTC", after), Some(ms("UTC", 2026, 11, 26, 9, 0)));
        assert_eq!(next("FREQ=YEARLY;BYDAY=20MO", "UTC", after), Some(ms("UTC", 2027, 5, 17, 0, 0)));
        // BYMONTHDAY with BYDAY must both match: Friday the 13th (13 November 2026).
        assert_eq!(next("FREQ=MONTHLY;BYMONTHDAY=13;BYDAY=FR", "UTC", after), Some(ms("UTC", 2026, 11, 13, 0, 0)));
        // A plain rule keeps the five-field form.
        assert!(parse("FREQ=WEEKLY;BYDAY=MO;BYHOUR=9").unwrap().rule.is_none());
        for (line, why) in [
            ("FREQ=DAILY;COUNT=3", "DTSTART"),
            ("DTSTART:20261013T090000 RRULE:FREQ=DAILY;COUNT=3;UNTIL=20261020", "not both"),
            ("FREQ=WEEKLY;BYDAY=1MO", "MONTHLY"),
            ("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=0", "BYSETPOS"),
            ("DTSTART:2026-10-13 RRULE:FREQ=DAILY", "DTSTART has"),
            ("FREQ=MONTHLY;BYDAY=0MO", "numbered weekday"),
            ("FREQ=DAILY;BYYEARDAY=1", "BYYEARDAY"),
        ] {
            assert!(parse(line).unwrap_err().contains(why), "{line}");
        }
    }

    #[test]
    fn a_clock_time_skipped_by_daylight_saving_still_runs() {
        // 02:30 does not exist in New York on 8 March 2026.
        let after = ms("America/New_York", 2026, 3, 7, 12, 0);
        let due = next("30 2 * * *", "America/New_York", after).unwrap();
        assert!(due > ms("America/New_York", 2026, 3, 8, 1, 59) && due < ms("America/New_York", 2026, 3, 8, 4, 0));
    }
}
