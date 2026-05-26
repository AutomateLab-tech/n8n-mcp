# n8n-mcp DXT bundle

This directory holds the [DXT](https://github.com/anthropics/dxt) manifest for
one-click install in Claude Desktop.

## Build

```bash
npm install -g @anthropic-ai/dxt
npm run build
cp -r dist dxt/dist
cp package.json dxt/package.json
cd dxt && dxt pack
```

That produces `n8n-mcp-<version>.dxt`. Drag-drop into Claude Desktop to install.

## Configuration

Users get a settings panel with the env vars defined under `user_config`:

- `n8n_api_url` / `n8n_api_key` — required only for the REST tools.
- `read_only` — set to `1` to disable write tools.
- `disabled_tools` — comma-separated tool names to skip.
- `allowed_workflow_ids` / `allowed_tags` — restrict REST tools to a fixed set.
