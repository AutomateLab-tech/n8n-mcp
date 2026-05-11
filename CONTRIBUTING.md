# Contributing to n8n-mcp

Thanks for your interest. This is a focused MCP server - we value quality over breadth. Read this before opening a PR.

## What we accept

- Bug fixes for existing tools
- Lint rules for n8n failure modes not yet covered (see `references/lint-rules.md`)
- Documentation improvements
- Test coverage

We are cautious about adding new tools - each one must encode a failure mode that AI agents reliably hit and can't recover from without server-side help.

## Dev setup

**Requirements:** Node >= 20, npm

```bash
git clone https://github.com/ratamaha-git/n8n-mcp.git
cd n8n-mcp
npm install
npm run build
```

Run the smoke test to verify the build:

```bash
npm run smoke
```

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your change - surgical edits only, match existing style
3. Run `npm run build` - must compile cleanly
4. Run `npm run smoke` - must pass
5. Open a PR against `main`

## PR checklist

- [ ] `npm run build` passes
- [ ] `npm run smoke` passes
- [ ] New lint rules include a test case in the PR description (before/after workflow JSON)
- [ ] No new dependencies added without discussion

## Commit style

Short imperative subject line, no period. Examples:

```
fix: handle missing typeVersion in lint
feat: add n8n_validate_credentials tool
docs: clarify AI Agent connection model
```

## Questions

Open a GitHub issue or email hello@automatelab.tech.
