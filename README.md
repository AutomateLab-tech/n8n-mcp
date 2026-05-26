# n8n-mcp

An [MCP](https://modelcontextprotocol.io) server for [n8n](https://n8n.io) that gives Claude, Cursor, and other AI agents tools for generating workflows, linting, diagnosing failed executions, and driving live n8n instances.

[![npm](https://img.shields.io/npm/v/@automatelab/n8n-mcp.svg)](https://www.npmjs.com/package/@automatelab/n8n-mcp)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/AutomateLab-tech/n8n-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/AutomateLab-tech/n8n-mcp/actions/workflows/ci.yml)

## Why we built this

We use n8n daily inside AutomateLab and kept hitting the same LLM failures: workflow JSON that imports but fails at runtime, AI Agent clusters wired with the wrong connection types, executions that silently drop items with no clue where to look. Dumping the whole n8n catalog into context doesn't fix it - the failure modes are too subtle (typeVersion mismatches, IF v1 schema, credentials that don't survive import).

So we built a small, focused server: **encode the failure modes the lint can catch, the cluster topology the generator must respect, and the diagnosis the agent can't do alone.** For a walkthrough of the nine tools with example output, see the [launch post on automatelab.tech](https://automatelab.tech/n8n-mcp-server/).

## Why it's different

Other n8n MCP servers (notably [czlonkowski/n8n-mcp](https://github.com/czlonkowski/n8n-mcp)) compete on breadth - 20+ tools and an indexed corpus of every n8n node. They own that niche.

This server is the **debugging-and-first-run-correctness MCP for n8n**:

- **`execution.explain`** is the wedge. Paste the execution JSON; get back per-node findings: which nodes returned 0 items, which had unresolved `={{ ... }}` expressions, error messages with concrete hints. No other MCP server does this well, and it hits the n8n community's #1 debugging pain point (silent data loss between nodes).
- **`workflow.generate`** is opinionated about AI Agent topology - emits proper LangChain clusters with `ai_languageModel` / `ai_memory` / `ai_tool` connections (sub-nodes connect *upward* to the agent, not via `main`). Imports cleanly on n8n 1.x.
- **`workflow.lint`** catches the silent failures: deprecated node types (Function → Code, spreadsheetFile → convertToFile), AI Agent missing language model, IF v1 schema, Webhook missing webhookId, broken connections across all connection types (not just `main`).
- **5 REST tools** (gated on `N8N_API_URL` + `N8N_API_KEY`) let you list, fetch, create, activate workflows and pull executions - so the lint and explain tools can run against your live workflows, not just JSON pasted in chat.

Plus: a paired [Agent Skill](./SKILL.md) that teaches the model when to use which tool and where to load deeper context (split into `references/` so it doesn't bloat the prompt).

## Tools

Tool names follow dot-notation and form a navigable tree: `node.*`, `workflow.*`, `execution.*`. Every tool declares an `outputSchema` (so callers can type-check responses) and MCP `annotations` (read-only / destructive / idempotent / open-world hints).

**Stateless** (work without a live n8n instance):

| Tool | Purpose |
|---|---|
| `workflow.generate` | Plain-English description → workflow JSON. Detects AI-agent intent. |
| `node.scaffold` | Description → single `INodeType` TypeScript file for a custom n8n package. |
| `workflow.lint` | Workflow JSON → list of errors and warnings (20+ rules). |
| `workflow.diff` | Two workflows → semantic diff (nodes added/removed/modified, connections, settings). |
| `execution.explain` | Failed execution JSON → per-node diagnosis with hints. |
| `execution.replay` | Workflow + node → self-contained replay workflow that exercises just that node. |
| `execution.timeline` | Execution JSON → per-node timeline table (start, duration, items in/out, errors). |

**Live-instance** (require `N8N_API_URL` + `N8N_API_KEY` env vars):

| Tool | Purpose |
|---|---|
| `workflow.list` | Paginate workflows; filter by active/tags/name. |
| `workflow.get` | Fetch a workflow by id. |
| `workflow.create` | POST a workflow. Strips read-only fields. |
| `workflow.activate` | Flip active on/off. |
| `execution.list` | Browse executions; pass `includeData: true` for the full body. |

> **v0.5.0 changes.** Three new tools: `workflow.diff`, `execution.replay`, `execution.timeline`. Lint expanded with 10 new rules (rate-limit, credential drift, expression staleness, code sandbox, webhook test path, manualTrigger-in-active, DST schedule risk, disabled-but-wired, empty Set, HTTP method/body mismatch). New runtime policy env vars: `N8N_MCP_READ_ONLY`, `N8N_MCP_DISABLED_TOOLS`, `N8N_MCP_ALLOWED_WORKFLOW_IDS`, `N8N_MCP_ALLOWED_TAGS`. DXT bundle + Dockerfile + Render/Railway/Fly deploy configs.

> **v0.4.0 breaking change.** Tools were renamed from `n8n_*` (snake_case) to dot-notation. Update any prompts, agent skills, or scripts that referenced the old names.

## Runtime policy (v0.5+)

Constrain the server without forking. Set these env vars before launching:

| Env var | Effect |
|---|---|
| `N8N_MCP_READ_ONLY=1` | Disables `workflow.create`, `workflow.activate`, `node.scaffold`. |
| `N8N_MCP_DISABLED_TOOLS=workflow.create,workflow.activate` | Skip those tool registrations entirely. |
| `N8N_MCP_ALLOWED_WORKFLOW_IDS=abc,def` | REST tools refuse to touch any workflow outside the list. |
| `N8N_MCP_ALLOWED_TAGS=prod,staging` | `workflow.list` filters to workflows carrying at least one tag. |

Useful when handing the MCP to a junior agent or wiring it behind a customer-facing assistant.

## Deploy

- **Claude Desktop one-click**: build the `.dxt` bundle from `dxt/manifest.json` (see `dxt/README.md`).
- **Docker**: `docker build -t n8n-mcp . && docker run --rm -i -e N8N_API_URL=... -e N8N_API_KEY=... n8n-mcp`.
- **Render**: drop in [`render.yaml`](./render.yaml) and click "New from Blueprint".
- **Railway**: [`railway.toml`](./railway.toml) — `railway up` in the repo root.
- **Fly.io**: [`fly.toml`](./fly.toml) — `fly launch --copy-config`.

## Install

Requires Node 20 or later.

### As a CLI tool

```bash
npm install -g @automatelab/n8n-mcp
```

### As a GitHub Action

Use the n8n MCP GitHub Action to lint workflows, diagnose executions, and generate workflow JSON in your CI/CD pipeline:

```yaml
- uses: ratamaha-git/n8n-mcp@v1
  with:
    command: 'lint'
    workflow-json: ${{ env.WORKFLOW_JSON }}
```

See [ACTION.md](./ACTION.md) and [GITHUB-ACTION-SETUP.md](./GITHUB-ACTION-SETUP.md) for examples and publication details.

## Configure your MCP host

**Cursor** (`~/.cursor/mcp.json`) or **Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "n8n": {
      "command": "npx",
      "args": ["-y", "@automatelab/n8n-mcp"],
      "env": {
        "N8N_API_URL": "https://your-n8n.example.com",
        "N8N_API_KEY": "n8n_..."
      }
    }
  }
}
```

The `env` block is optional - the 4 stateless tools work without it. Get an API key from n8n: **Settings → API → Create API key**.

Restart your MCP host. The 12 dot-notation tools (`workflow.*`, `node.*`, `execution.*`) appear in the MCP panel.

## Tool examples

### `workflow.generate`

> Use workflow.generate to build: Stripe webhook → Slack message + new row in Google Sheets.

Returns workflow JSON ready for n8n's "Import from File" dialog.

### `execution.explain`

> Here's a failed execution from n8n. Why is the Slack node not firing?
> [paste JSON]

Returns:
```
WARNING [Filter] Returned 0 items. Downstream nodes will not execute.
  hint: Common causes: (1) IF/Switch routed to the other branch — check `parameters.conditions`. (2) Filter/Set node dropped everything — inspect its output explicitly.

INFO [Last node executed was "Filter". If the workflow stopped here unexpectedly, check its output items below.]
```

### `workflow.lint`

> Lint this workflow JSON.
> [paste JSON]

Returns:
```
ERROR [AI Agent] AI Agent has no `ai_languageModel` sub-node connected. Attach a chat model (e.g. lmChatOpenAi).
WARNING [Webhook] Webhook node has no `webhookId`. n8n auto-generates one on import, so the production URL will change.
WARNING [LegacyFunction] Node type "n8n-nodes-base.function" is deprecated. Use "n8n-nodes-base.code".
```

Or `no issues found`.

## Examples

The `examples/` directory ships with two ready-to-import workflows:

- `workflow-stripe-to-slack.json` - Stripe webhook fans out to Slack and Google Sheets.
- `workflow-rss-to-discord.json` - RSS feed trigger posts new items to a Discord channel.

Import either via n8n's **Import from File** dialog.

## Development

```bash
git clone https://github.com/ratamaha-git/n8n-mcp
cd n8n-mcp
npm install
npm run build
npm run smoke
```

`npm run smoke` boots the server with a `--smoke` flag that lists registered tools and exits without binding stdio. Useful for CI or first-run sanity checks.

## License

MIT. See [LICENSE](./LICENSE).

---

Developed by [AutomateLab](https://automatelab.tech).
