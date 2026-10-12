# JSON answers and exit codes

With `--json` every command prints one envelope:

    { "requestId": "...", "success": true, "result": { ... } }

On failure `success` is false and `error` carries a `code`, a `message` and sometimes
`data.hint`. Read the code, not the message: messages are written for people and may change.

Exit codes: 0 worked, 1 any error. Without `--json`, errors go to stderr.
