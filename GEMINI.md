# n8n-mcp

Use when the user wants to build, debug, or extend an n8n workflow - generating workflow JSON from a description, scaffolding a custom TypeScript node, building an AI agent (LangChain cluster), iterating over items, writing Code-node JS, linting an existing workflow, diagnosing a failed execution, or driving a live n8n instance via REST.

Pairs with the `@automatelab/n8n-mcp` server (loaded automatically by this extension). The server exposes 9 MCP tools; this context tells you when to use which.

## Tool routing

Tool names use dot-notation: `node.*`, `workflow.*`, `execution.*` (renamed in v0.4.0 from `n8n_*`).

**Stateless tools** (work without any n8n instance):

- `workflow.generate` - plain-English description -> workflow JSON. Detects AI-agent intent and emits a LangChain cluster.
- `node.scaffold` - description -> single `INodeType` TypeScript file for a custom n8n package.
- `workflow.lint` - workflow JSON -> list of issues (deprecated types, missing `typeVersion`, broken connections, AI Agent without `ai_languageModel`, IF v1 schema, etc.).
- `execution.explain` - failed/surprising execution JSON -> diagnosis. Catches the #1 n8n pain point: items "silently disappearing" between nodes. Also flags unresolved `={{ ... }}` expressions and surfaces LLM token usage.

**Live-instance tools** (require `N8N_API_URL` + `N8N_API_KEY` env vars):

- `workflow.list` - paginate workflows; filter by active/tags/name.
- `workflow.get` - fetch a workflow by id. Pair with `workflow.lint` to audit deployed workflows.
- `workflow.create` - POST a generated workflow. Strips read-only fields. Workflow is created inactive.
- `workflow.activate` - flip active on/off.
- `execution.list` - browse executions; pass `includeData: true` for the full body. Pair with `execution.explain`.

Default chains:
- *Generate, then ship*: `workflow.generate` -> `workflow.lint` -> (if env configured) `workflow.create` -> `workflow.activate`.
- *Audit a deployed workflow*: `workflow.list` -> `workflow.get` -> `workflow.lint`.
- *Diagnose a failure*: `execution.list {status: "error"}` -> pick one -> `execution.list {includeData: true, ...}` -> `execution.explain`.

## When the user describes a flow

1. Run `workflow.generate` with their description verbatim.
2. Run `workflow.lint` on the result.
3. If lint clean -> return the JSON. If warnings -> return JSON + a one-line summary of warnings. If errors -> fix them before returning.

## When the user pastes execution data and says "why is X empty?"

1. Run `execution.explain` with the JSON.
2. Read the findings; if the answer is in the report, summarize. Otherwise inspect the workflow node's `parameters` block manually.

## Loading deeper context

Load from the extension's `references/` directory only when the task needs that depth:

- `references/expressions.md` - `$json`, `$input.all()`, `$("Node Name")`, auto-iteration.
- `references/ai-agents.md` - LangChain cluster topology, `ai_languageModel` / `ai_memory` / `ai_tool` connection types, sub-node catalog.
- `references/code-node.md` - Code node return-shape contract, what breaks, sandbox limits.
- `references/workflow-json.md` - `nodes`/`connections` structure, required fields, credential block.
- `references/iteration.md` - Split Out vs Loop Over Items vs Aggregate.
- `references/deprecations.md` - retired node types and their replacements.

---

Developed by [AutomateLab](https://automatelab.tech). Source: [github.com/ratamaha-git/n8n-mcp](https://github.com/ratamaha-git/n8n-mcp).
