---
name: n8n
description: Use when the user wants to build, debug, or extend an n8n workflow - generating workflow JSON from a description, scaffolding a custom TypeScript node, building an AI agent (LangChain cluster), iterating over items, writing Code-node JS, linting an existing workflow, diagnosing a failed execution, or driving a live n8n instance via REST.
version: 0.4.0
license: MIT
homepage: https://github.com/ratamaha-git/n8n-mcp
compatibility:
  hosts:
    - claude-code
    - cursor
    - claude-desktop
    - windsurf
    - vscode
    - zed
    - continue
    - cline
    - jetbrains
    - warp
metadata:
  npm: "@automatelab/n8n-mcp"
  mcpName: io.github.ratamaha-git/n8n-mcp
---

# n8n

Pairs with the `@automatelab/n8n-mcp` server. The server exposes 9 MCP tools; this skill tells you when to use which and where to load deeper context.

## Tool routing

Tool names use dot-notation: `node.*`, `workflow.*`, `execution.*` (renamed in v0.4.0 from `n8n_*`).

**Stateless tools** (work without any n8n instance):

- `workflow.generate` - plain-English description → workflow JSON. Detects AI-agent intent and emits a LangChain cluster.
- `node.scaffold` - description → single `INodeType` TypeScript file for a custom n8n package.
- `workflow.lint` - workflow JSON → list of issues (deprecated types, missing `typeVersion`, broken connections, AI Agent without `ai_languageModel`, IF v1 schema, etc.).
- `execution.explain` - failed/surprising execution JSON → diagnosis. Catches the #1 n8n pain point: items "silently disappearing" between nodes. Also flags unresolved `={{ ... }}` expressions and surfaces LLM token usage.

**Live-instance tools** (require `N8N_API_URL` + `N8N_API_KEY` env vars):

- `workflow.list` - paginate workflows; filter by active/tags/name.
- `workflow.get` - fetch a workflow by id. Pair with `workflow.lint` to audit deployed workflows.
- `workflow.create` - POST a generated workflow. Strips read-only fields. Workflow is created inactive.
- `workflow.activate` - flip active on/off.
- `execution.list` - browse executions; pass `includeData: true` for the full body. Pair with `execution.explain`.

Default chains:
- *Generate, then ship*: `workflow.generate` → `workflow.lint` → (if env configured) `workflow.create` → `workflow.activate`.
- *Audit a deployed workflow*: `workflow.list` → `workflow.get` → `workflow.lint`.
- *Diagnose a failure*: `execution.list {status: "error"}` → pick one → `execution.list {includeData: true, ...}` → `execution.explain`.

## When the user describes a flow

1. Run `workflow.generate` with their description verbatim.
2. Run `workflow.lint` on the result.
3. If lint clean → return the JSON. If warnings → return JSON + a one-line summary of warnings. If errors → fix them (usually by editing the JSON inline or re-prompting the user) before returning.

## When the user pastes execution data and says "why is X empty?"

1. Run `execution.explain` with the JSON.
2. Read the findings; if the answer is in the report (e.g. "Node Y returned 0 items because IF condition routed to other branch"), summarize. Otherwise inspect the workflow node's `parameters` block manually.

## Loading deeper context

The skill stays small to keep your context window free. Load from `references/` only when the task actually needs that depth:

- `references/expressions.md` - `$json`, `$input.all()`, `$("Node Name")`, auto-iteration. **Load when**: writing or debugging expressions, or the user says "use `$json[0]`" (common mistake).
- `references/ai-agents.md` - LangChain cluster topology, `ai_languageModel` / `ai_memory` / `ai_tool` connection types, sub-node catalog. **Load when**: building an AI agent or the lint flags an agent without a language model.
- `references/code-node.md` - Code node return-shape contract, what breaks, sandbox limits. **Load when**: writing a Code node or the user reports "Code node fails silently."
- `references/workflow-json.md` - `nodes`/`connections` structure, required fields, credential block. **Load when**: hand-editing workflow JSON or merging two workflows.
- `references/iteration.md` - Split Out vs Loop Over Items vs Aggregate. **Load when**: the user says "loop over an array" or "process N at a time."
- `references/deprecations.md` - retired node types and their replacements. **Load when**: lint flags a deprecation or the user is migrating an old workflow.

## Server setup

Add to the user's MCP config (Cursor: `~/.cursor/mcp.json`, Claude Desktop: `claude_desktop_config.json`):

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

The `env` block is optional — the 4 stateless tools work without it. Get an API key from n8n: Settings → API → Create API key.

---

Developed by [AutomateLab](https://automatelab.tech). Source: [github.com/ratamaha-git/n8n-mcp](https://github.com/ratamaha-git/n8n-mcp).
