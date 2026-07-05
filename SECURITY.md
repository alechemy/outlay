# Security Policy

outlay is a pure-arithmetic library: no network access, no filesystem access, no `eval`, no dependencies at runtime. Its attack surface is limited to pathological input trees (e.g. adversarially deep nesting causing stack exhaustion).

## Reporting a vulnerability

Report vulnerabilities privately via [GitHub Security Advisories](https://github.com/alechemy/outlay/security/advisories/new). Do not open a public issue for security reports.

You can expect an acknowledgment within a week. Fixes ship as patch releases with the advisory credited unless you prefer otherwise.
