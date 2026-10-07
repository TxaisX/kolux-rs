# specs/business-frame

## MAP.md (171 lines)
- # Capability Map: Business power-user frame (Kolux 0.13.0)
- ## Why
- ## Owner decisions (2026-09-28)
- ## Modules
- ## Shared engineering contract (applies to every module)
- ### Tech stack
- ### Commands
- ### Project structure
- ### Code style
- ### Testing strategy
- ### Telemetry
- ### Boundaries

## SPEC-focus-three.md (53 lines)
- # Spec: focus-three
- ## Objective
- ## Design
- ## Success criteria
- ## Boundaries (module-specific)

## SPEC-guided-first-run.md (96 lines)
- # Spec: guided-first-run
- ## Objective
- ## Today → target
- ## Existing users and versioning
- ## Measuring the 3-hour goal
- ## Files likely touched
- ## Success criteria
- ## Boundaries (module-specific)

## SPEC-key-vault.md (95 lines)
- # Spec: key-vault
- ## Objective
- ## Scope: what gets fixed
- ## Migration
- ## Success criteria
- ## Boundaries (module-specific)

## SPEC-paste-once-signin.md (137 lines)
- # Spec: paste-once-signin
- ## Objective
- ## The Connect card (Settings > AI connections, and step 2 of `guided-first-run`)
- ## Install
- ## Claude
- ## Codex
- ## Grok
- ## Files likely touched
- ## Success criteria
- ## Boundaries (module-specific)

## SPEC-plain-language.md (79 lines)
- # Spec: plain-language
- ## Objective
- ## Rule
- ## Glossary: `src/shared/plain-language-glossary.ts`
- ## Scope
- ## Design
- ## Success criteria
- ## Boundaries (module-specific)

## SPEC-starter-kits.md (112 lines)
- # Spec: starter-kits
- ## Objective
- ## Rules for v1 kits
- ## What a kit is
- ## v1 kits (6)
- ## Sample data
- ## Results
- ## Files likely touched
- ## Success criteria
- ## Boundaries (module-specific)

## MAP.md table rows (verbatim)

| Module id | Delivers | Depends on |
|---|---|---|
| `key-vault` | Kolux's own stored credential copies encrypted; plaintext fallbacks surfaced; redaction gaps closed | — |
| `focus-three` | Claude, Codex, Grok first everywhere; other agents collapsed behind "Show more agents" (presentation only) | — |
| `plain-language` | Plain words with the technical term one hover away on the newcomer path, plus the glossary the other modules reuse | — |
| `paste-once-signin` | One Connect card per AI: install, sign in once, stay signed in | `key-vault`, `plain-language` (strings) |
| `starter-kits` | Business task templates that open the right sessions, sample data, and Collect/Open results | `focus-three`, `paste-once-signin` |
| `guided-first-run` | First run in four plain screens ending in a running kit; "Explore Kolux" extended into a tour of the grid | all of the above |
