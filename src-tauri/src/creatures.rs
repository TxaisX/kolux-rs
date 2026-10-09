//! Creature names for workspaces an agent launch makes for itself (SESS-023, PROJ-023): a short
//! adjective and a sea creature, `amber-otter`. A name never repeats one a workspace already
//! uses (letter case ignored); when every pair is taken, numbered rounds follow (`amber-otter-2`).

const ADJECTIVES: &[&str] = &[
    "amber", "brisk", "calm", "coral", "dusky", "eager", "fleet", "gentle", "golden", "hazel", "ivory", "jade", "keen", "lively", "misty", "nimble", "olive", "pale", "quiet", "rosy", "sandy", "silver", "sunny", "tidal", "velvet", "windy",
];

const CREATURES: &[&str] = &[
    "otter", "seal", "orca", "dolphin", "manta", "turtle", "octopus", "squid", "nautilus", "urchin", "starfish", "seahorse", "marlin", "tuna", "puffin", "pelican", "heron", "walrus", "narwhal", "beluga", "lobster", "crab", "shrimp", "eel", "ray", "anemone",
];

/// Every pair in a fixed order that spreads the adjectives (so neighbouring picks differ in
/// both words), followed by the same pairs with `-2`, `-3`, ... once a round is used up.
fn candidates(seed: usize) -> impl Iterator<Item = String> {
    let a = ADJECTIVES.len();
    let c = CREATURES.len();
    let total = a * c;
    (0..).flat_map(move |round: usize| {
        (0..total).map(move |i| {
            let k = (seed + i) % total;
            let adj = ADJECTIVES[k % a];
            let creature = CREATURES[(k / a + k % a) % c];
            if round == 0 {
                format!("{adj}-{creature}")
            } else {
                format!("{adj}-{creature}-{}", round + 1)
            }
        })
    })
}

/// The first free name, starting from `seed` (any number; the caller passes the clock so two
/// launches minutes apart do not always begin at the same pair). `taken` holds the names already
/// in use anywhere, compared without regard to case.
pub fn creature_name(taken: &[String], seed: u64) -> String {
    let used: Vec<String> = taken.iter().map(|t| t.to_lowercase()).collect();
    let total = ADJECTIVES.len() * CREATURES.len();
    candidates((seed % total as u64) as usize)
        .find(|name| !used.contains(name))
        .expect("the candidate list never ends")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_an_adjective_and_a_creature_joined_by_a_hyphen() {
        for seed in [0u64, 1, 17, 999_999] {
            let name = creature_name(&[], seed);
            let (adj, creature) = name.split_once('-').expect("one hyphen");
            assert!(ADJECTIVES.contains(&adj), "{name}");
            assert!(CREATURES.contains(&creature), "{name}");
        }
    }

    #[test]
    fn a_taken_name_is_never_suggested_whatever_its_case() {
        let first = creature_name(&[], 5);
        let second = creature_name(&[first.to_uppercase()], 5);
        assert_ne!(first, second);
        assert!(!second.contains("-2"), "plenty of pairs left, no numbered round yet");
    }

    #[test]
    fn once_every_pair_is_used_numbered_rounds_follow() {
        let total = ADJECTIVES.len() * CREATURES.len();
        let all: Vec<String> = candidates(0).take(total).collect();
        let unique: std::collections::HashSet<&String> = all.iter().collect();
        assert_eq!(unique.len(), total, "every pair appears exactly once in a round");
        let next = creature_name(&all, 3);
        assert!(next.ends_with("-2"), "{next}");
        assert!(!all.contains(&next));
    }
}
