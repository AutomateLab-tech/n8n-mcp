# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.3.x   | Yes       |
| < 0.3   | No        |

## Reporting a Vulnerability

If you find a security issue in n8n-mcp, please **do not open a public GitHub issue**.

Report it privately by emailing: **hello@automatelab.tech**

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

We will acknowledge your report within 48 hours and aim to ship a patch within 14 days for confirmed issues. We will credit reporters in the release notes unless you request otherwise.

## Scope

This MCP server runs locally on the user's machine and communicates with a local or self-hosted n8n instance. The attack surface is limited - there is no authentication layer, no remote code execution surface, and no user data stored. The main risk areas are:

- Improper handling of workflow JSON from untrusted sources
- Credentials passed via environment variables (`N8N_API_URL`, `N8N_API_KEY`) exposed through process inspection

Out of scope: issues in n8n itself, MCP host applications (Claude, Cursor), or the user's n8n instance.
