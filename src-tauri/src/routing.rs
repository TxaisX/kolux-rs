//! Model routing for orchestration workers (SET-028, ACCT-034): for each provider that can route
//! by tier, the model and effort each of the four tiers (Major, Deep, Build, Light) means. The
//! shipped ladder is the default; the user's picks live in settings under `modelRouting`, as
//! `{ "<provider>": { "<tier>": { "model": "<id or empty>", "effort": "<level or empty>" } } }`.
//! An empty model means "the provider's own default": no `--model` and no effort is passed.
use serde::Serialize;
use serde_json::Value;

pub const TIERS: [&str; 4] = ["major", "deep", "build", "light"];
pub const SETTINGS_KEY: &str = "modelRouting";

#[derive(Serialize, Clone)]
pub struct Model {
    pub id: &'static str,
    pub label: &'static str,
    /// Effort levels this model takes; empty means it has none and the picker hides.
    pub efforts: &'static [&'static str],
}

#[derive(Serialize, Clone)]
pub struct Pick {
    pub model: &'static str,
    pub effort: Option<&'static str>,
}

#[derive(Serialize, Clone)]
pub struct Provider {
    pub id: &'static str,
    pub name: &'static str,
    pub models: &'static [Model],
    /// The shipped ladder, in `TIERS` order.
    pub defaults: [Pick; 4],
}

const CLAUDE_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];
const CODEX_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh"];

const CLAUDE_MODELS: &[Model] = &[
    Model { id: "fable", label: "Claude Fable", efforts: CLAUDE_EFFORTS },
    Model { id: "opus", label: "Claude Opus", efforts: CLAUDE_EFFORTS },
    Model { id: "sonnet", label: "Claude Sonnet", efforts: CLAUDE_EFFORTS },
    Model { id: "haiku", label: "Claude Haiku", efforts: &[] },
];
const CODEX_MODELS: &[Model] = &[
    Model { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", efforts: CODEX_EFFORTS },
    Model { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", efforts: CODEX_EFFORTS },
    Model { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", efforts: CODEX_EFFORTS },
];

const fn pick(model: &'static str, effort: Option<&'static str>) -> Pick {
    Pick { model, effort }
}

/// Only these providers can route by tier, so only these are listed (SET-028).
/// ponytail: built-in model lists; SESS-029 (P1) asks the installed program for its live list.
pub fn providers() -> Vec<Provider> {
    vec![
        Provider {
            id: "claude",
            name: "Claude Code",
            models: CLAUDE_MODELS,
            defaults: [pick("fable", Some("high")), pick("opus", Some("high")), pick("sonnet", Some("medium")), pick("haiku", None)],
        },
        Provider {
            id: "codex",
            name: "Codex",
            models: CODEX_MODELS,
            defaults: [pick("gpt-5.6-sol", Some("high")), pick("gpt-5.6-terra", Some("high")), pick("gpt-5.6-terra", Some("medium")), pick("gpt-5.6-luna", Some("low"))],
        },
    ]
}

/// The model and effort a tier means for a provider: the user's pick when there is one, else the
/// shipped ladder. An effort the chosen model does not take is dropped. `None` model means the
/// provider's default. Errors name a provider that cannot route or a tier that does not exist.
pub fn route(settings: &Value, agent: &str, tier: &str) -> Result<(Option<String>, Option<String>), String> {
    let all = providers();
    let p = all.iter().find(|p| p.id == agent).ok_or_else(|| format!("{agent} has no model route for the {tier} tier"))?;
    let i = TIERS.iter().position(|t| *t == tier).ok_or_else(|| format!("there is no {tier} tier; use major, deep, build or light"))?;
    let saved = &settings[SETTINGS_KEY][agent][tier];
    let text = |k: &str| saved[k].as_str().map(str::trim).map(str::to_string);
    let (model, effort) = if saved.is_object() {
        (text("model").unwrap_or_default(), text("effort").unwrap_or_default())
    } else {
        let d = &p.defaults[i];
        (d.model.to_string(), d.effort.unwrap_or_default().to_string())
    };
    if model.is_empty() {
        return Ok((None, None));
    }
    let offered = p.models.iter().find(|m| m.id == model).map(|m| m.efforts).unwrap_or(&[]);
    let effort = Some(effort).filter(|e| offered.contains(&e.as_str()));
    Ok((Some(model), effort))
}

#[tauri::command]
pub fn routing_catalog() -> Vec<Provider> {
    providers()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn r(settings: &Value, agent: &str, tier: &str) -> (Option<String>, Option<String>) {
        route(settings, agent, tier).unwrap()
    }
    fn s(v: &str) -> Option<String> {
        Some(v.to_string())
    }

    #[test]
    fn nothing_saved_means_the_shipped_ladder() {
        let none = json!({});
        assert_eq!(r(&none, "claude", "build"), (s("sonnet"), s("medium")));
        assert_eq!(r(&none, "claude", "light"), (s("haiku"), None));
        assert_eq!(r(&none, "codex", "major"), (s("gpt-5.6-sol"), s("high")));
    }

    #[test]
    fn a_saved_pick_wins_and_an_effort_the_model_lacks_is_dropped() {
        let saved = json!({ "modelRouting": { "claude": { "light": { "model": "sonnet", "effort": "low" }, "deep": { "model": "haiku", "effort": "high" } } } });
        assert_eq!(r(&saved, "claude", "light"), (s("sonnet"), s("low")));
        assert_eq!(r(&saved, "claude", "deep"), (s("haiku"), None));
        // Other tiers and the other provider keep their defaults.
        assert_eq!(r(&saved, "claude", "build"), (s("sonnet"), s("medium")));
        assert_eq!(r(&saved, "codex", "light"), (s("gpt-5.6-luna"), s("low")));
    }

    #[test]
    fn an_empty_tier_is_the_providers_default_and_bad_names_are_refused() {
        let saved = json!({ "modelRouting": { "codex": { "build": { "model": "", "effort": "high" } } } });
        assert_eq!(r(&saved, "codex", "build"), (None, None));
        assert!(route(&saved, "gemini", "build").unwrap_err().contains("no model route"));
        assert!(route(&saved, "claude", "huge").unwrap_err().contains("no huge tier"));
    }
}
