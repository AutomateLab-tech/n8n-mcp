# n8n MCP maintenance guide

Start with workflow_lint on exported JSON. Use execution_explain for a failed execution. Live tools need an n8n API URL and key; review workflow_create and workflow_activate before allowing changes.

## Installation and compatibility

Follow the repository README for the supported install method and runtime. Pin the version used in a reproducible example. Keep credentials in your client configuration, outside shared fixtures.

## Verified tool surface

The local compiled server returned these names through MCP `tools/list` on 12 October 2026. Recheck after upgrading.

- `node_scaffold`
- `workflow_generate`
- `workflow_lint`
- `workflow_diff`
- `execution_explain`
- `execution_replay`
- `execution_timeline`
- `workflow_list`
- `workflow_get`
- `workflow_create`
- `workflow_activate`
- `execution_list`

## First call

Start with `workflow_lint`. Required fields: `workflow`. Read its input schema before passing a recorded fixture.

## Verify a change

Record the package or snapshot version, exact input, observation time and actual output. Check a materially different input and a valid neighboring case. Treat expected output as a fixture, not a live measurement.
