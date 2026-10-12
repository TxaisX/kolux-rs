---
name: koluxsecurity
description: Review a change for security problems before it is merged.
---

# Security review

Before you call a change done, read it as someone trying to misuse it.

- Input from users, files, the network or other agents is untrusted until checked.
- Secrets never go into code, logs, commit messages or command lines.
- Shell commands are built from argument lists, never by pasting strings together.
- Paths from outside are checked to stay inside the folder they belong to.
- New dependencies are named, pinned and justified.

Report each finding with the file, what can go wrong, and the smallest fix.

References: `kolux skills get koluxsecurity --references` lists them.
