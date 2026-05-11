# n8n-mcp for Cline

An MCP server for n8n that gives Claude, Cursor, Cline, and other AI agents tools for generating workflows, linting, diagnosing failed executions, and driving live n8n instances.

## Installation

### Prerequisites

- Node.js 20 or later
- npm

### Install the MCP server

```bash
npm install -g @automatelab/n8n-mcp
```

## Configuration

### Option 1: Without Live n8n Instance (Stateless)

Use the 4 stateless tools that work without connecting to a live n8n instance:
- `n8n_generate_workflow` - plain-English description → workflow JSON
- `n8n_scaffold_node` - description → custom `INodeType` TypeScript file
- `n8n_lint_workflow` - workflow JSON → list of errors and warnings
- `n8n_explain_execution` - failed execution JSON → per-node diagnosis

In Cline's `cline_config.json` (or `.cline/mcp.json`):

```json
{
  "mcpServers": {
    "n8n": {
      "command": "npx",
      "args": ["-y", "@automatelab/n8n-mcp"]
    }
  }
}
```

### Option 2: With Live n8n Instance (Full)

To enable all 9 tools (including workflow REST operations), configure your n8n API credentials:

In Cline's `cline_config.json`:

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

**Get an API key from n8n**: Settings → API → Create API key.

## Tools Overview

**Stateless Tools** (no n8n instance required):

| Tool | Purpose |
|------|---------|
| `n8n_generate_workflow` | Plain-English description → workflow JSON. Detects AI-agent topology and emits proper LangChain clusters. |
| `n8n_scaffold_node` | Description → single custom node TypeScript file ready to package. |
| `n8n_lint_workflow` | Workflow JSON → list of issues (deprecated types, missing `typeVersion`, broken connections, AI Agent missing language model, etc.). |
| `n8n_explain_execution` | Failed execution JSON → per-node findings with concrete hints. Catches silent data loss between nodes. |

**Live-Instance Tools** (require `N8N_API_URL` + `N8N_API_KEY`):

| Tool | Purpose |
|------|---------|
| `n8n_list_workflows` | Paginate workflows; filter by active/tags/name. |
| `n8n_get_workflow` | Fetch a workflow by id. Pair with lint to audit deployed workflows. |
| `n8n_create_workflow` | POST a generated workflow. Strips read-only fields. |
| `n8n_activate_workflow` | Flip active on/off. |
| `n8n_list_executions` | Browse executions; pass `includeData: true` for full body. Pair with explain to diagnose failures. |

## Usage Patterns

**Generate and lint a workflow**:
1. Use `n8n_generate_workflow` with your plain-English description
2. Use `n8n_lint_workflow` on the result to catch issues before import

**Deploy to your n8n instance**:
1. Generate and lint the workflow
2. Use `n8n_create_workflow` to POST it (created inactive)
3. Use `n8n_activate_workflow` to turn it on

**Diagnose a failed execution**:
1. Use `n8n_list_executions` with `{status: "error"}` filter
2. Use `n8n_list_executions` with `{includeData: true}` on the execution id to get full data
3. Use `n8n_explain_execution` to get per-node diagnosis with hints

## Examples

The project ships with ready-to-import example workflows in `examples/`:
- `workflow-stripe-to-slack.json` - Stripe webhook fans out to Slack and Google Sheets
- `workflow-rss-to-discord.json` - RSS feed trigger posts new items to a Discord channel

## Documentation

For deeper context on n8n concepts:
- **Expressions** - `$json`, `$input.all()`, `$("Node Name")`, auto-iteration
- **AI Agents** - LangChain cluster topology, connection types, sub-node catalog
- **Code Node** - return-shape contract, sandbox limits, what breaks
- **Workflow JSON** - `nodes`/`connections` structure, required fields
- **Iteration** - Split Out vs Loop Over Items vs Aggregate
- **Deprecations** - retired node types and their replacements

See the project repository for detailed reference files.

## Troubleshooting

**Tools not appearing in Cline?**
- Verify Node.js 20+ is installed: `node --version`
- Reinstall the package: `npm install -g @automatelab/n8n-mcp`
- Restart Cline

**API connection errors?**
- Verify `N8N_API_URL` and `N8N_API_KEY` are correct
- Check that your n8n instance is accessible and the API key is valid
- Get a fresh API key from n8n: Settings → API → Create API key

**"Silent data loss" in workflows?**
- Use `n8n_explain_execution` to diagnose which nodes returned 0 items
- Check IF/Switch node conditions and Filter node parameters
- Verify upstream nodes are actually returning data

## More Information

- Repository: https://github.com/ratamaha-git/n8n-mcp
- Project: https://automatelab.tech
- Launch Post: https://automatelab.tech/n8n-mcp-server/
