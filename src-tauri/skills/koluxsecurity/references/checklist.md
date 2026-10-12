# Review checklist

| Area | Ask |
|---|---|
| Input | Is every value from outside checked for type, size and range? |
| Commands | Could a value break out of its argument and run something else? |
| Files | Could a path climb out with `..` or follow a link somewhere else? |
| Secrets | Is any key, token or password printed, logged or stored in plain text? |
| Network | Is every call made over TLS to an address the user chose? |
| Errors | Does a failure leave things half-changed, or leak internals in its message? |
