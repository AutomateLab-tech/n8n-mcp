# n8n-mcp

Use when the user wants to build, debug, or extend an n8n workflow - generating workflow JSON from a description, scaffolding a custom TypeScript node, building an AI agent (LangChain cluster), iterating over items, writing Code-node JS, linting an existing workflow, diagnosing a failed execution, or driving a live n8n instance via REST.

Pairs with the `@automatelab/n8n-mcp` server (loaded automatically by this extension). The server exposes 9 MCP tools; this context tells you when to use which.

## Tool routing

**Stateless tools** (work without any n8n instance):

- `n8n_generate_workflow` - plain-English description -> workflow JSON. Detects AI-agent intent and emits a LangChain cluster.
- `n8n_scaffold_node` - description -> single `INodeType` TypeScript file for a custom n8n package.
- `n8n_lint_workflow` - workflow JSON -> list of issues (deprecated types, missing `typeVersion`, broken connections, AI Agent without `ai_languageModel`, IF v1 schema, etc.).
- `n8n_explain_execution` - failed/surprising execution JSON -> diagnosis. Catches the #1 n8n pain point: items "silently disappearing" between nodes. Also flags unresolved `={{ ... }}` expressions and surfaces LLM token usage.

**Live-instance tools** (require `N8N_API_URL` + `N8N_API_KEY` env vars):

- `n8n_list_workflows` - paginate workflows; filter by active/tags/name.
- `n8n_get_workflow` - fetch a workflow by id. Pair with `n8n_lint_workflow` to audit deployed workflows.
- `n8n_create_workflow` - POST a generated workflow. Strips read-only fields. Workflow is created inactive.
- `n8n_activate_workflow` - flip active on/off.
- `n8n_list_executions` - browse executions; pass `includeData: true` for the full body. Pair with `n8n_explain_execution`.

Default chains:
- *Generate, then ship*: `generate_workflow` -> `lint_workflow` -> (if env configured) `create_workflow` -> `activate_workflow`.
- *Audit a deployed workflow*: `list_workflows` -> `get_workflow` -> `lint_workflow`.
- *Diagnose a failure*: `list_executions {status: "error"}` -> pick one -> `list_executions {includeData: true, ...}` -> `explain_execution`.

## When the user describes a flow

1. Run `n8n_generate_workflow` with their description verbatim.
2. Run `n8n_lint_workflow` on the result.
3. If lint clean -> return the JSON. If warnings -> return JSON + a one-line summary of warnings. If errors -> fix them before returning.

## When the user pastes execution data and says "why is X empty?"

1. Run `n8n_explain_execution` with the JSON.
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
