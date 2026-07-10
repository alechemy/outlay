# Security Policy

outlay's core solver is pure arithmetic: no network access, no filesystem access, no `eval`, and no runtime dependencies. The `outlay/html` subpath adds one runtime dependency, `htmlparser2`, and `outlay/pretext` uses the optional `@chenglou/pretext` peer; nothing else pulls in third-party code. The attack surface is limited to pathological input trees (e.g. adversarially deep nesting causing stack exhaustion).

## Reporting a vulnerability

Report vulnerabilities privately via [GitHub Security Advisories](https://github.com/alechemy/outlay/security/advisories/new). Do not open a public issue for security reports.

You can expect an acknowledgment within a week. Fixes ship as patch releases with the advisory credited unless you prefer otherwise.
