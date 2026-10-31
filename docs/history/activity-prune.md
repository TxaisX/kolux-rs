# The Recent-sort stamp map no longer grows forever

<!-- html -->

Every workspace folder the user ever opened was kept in the store permanently, and the whole map was
read and rewritten on every single touch. It is now capped at the 2,000 most recently used.

---

## The problem

`activity.rs` keeps a `workspace -> last used` map so the sidebar's **Recent** sort can put the
workspace you just worked in at the top. The file said so itself:

```rust
// ponytail: the map keeps every folder ever stamped; prune it if it grows past a few thousand.
```

Two costs, both growing with use:

1. **The store grows without bound.** Every folder ever opened keeps an entry forever, across
   restarts, in `state.db`.
2. **Every touch rewrites the whole map.** `touch()` reads the entire map, inserts one key, and
   writes the entire map back. At a few thousand folders that is a few hundred kilobytes serialised
   on each activity change — and activity changes on every agent state transition.

The Recent sort only ever displays a handful of workspaces, so the thousands of old entries bought
nothing.

## The fix

```rust
/// The workspace folders one store keeps stamps for.
const WORKSPACE_KEEP: usize = 2_000;
```

After the insert, if the map is over the cap it is sorted newest-first and truncated. Ties break on
the key so the same map always prunes to the same set — the result is deterministic rather than
dependent on hash order.

```rust
if map.len() > WORKSPACE_KEEP {
    let mut by_age: Vec<(String, u64)> = map.into_iter().collect();
    by_age.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    by_age.truncate(WORKSPACE_KEEP);
    map = by_age.into_iter().collect();
}
```

2,000 is deliberately far above anything the Recent list can show, so no user-visible behaviour
changes for any realistic number of projects.

## What is *not* changed

- The key format (`key()`), and therefore the rule that two spellings of one folder share an entry
- The "newer than every stamp, not just this key's" ordering, which PROJ-051 box 2 depends on
- The corrupt-store handling that keeps an unreadable map aside before starting fresh

## The test

`proj051_keeps_only_the_most_recently_used_folders` seeds a full map **directly** and then touches
once. Seeding by calling `touch` 2,000 times would rewrite the store 2,000 times and make the test
measure disk speed instead of the prune.

```rust
assert_eq!(map.len(), WORKSPACE_KEEP, "the map is capped at the limit, not one over");
assert!(map.contains_key("c:/repo/new"), "the folder just used is kept");
assert!(!map.contains_key("c:/repo/s0"), "the oldest stamp falls off");
```

## Gates

```
cargo test --lib activity
test result: ok. 25 passed; 0 failed; 0 ignored
```

The new test and both existing PROJ-051 tests pass together, so the ordering rule survived the cap.
