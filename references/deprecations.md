# Deprecations and import gotchas

`workflow.lint` flags these. Avoid producing them in fresh workflows.

## Removed / renamed node types

| Old type | Replacement | Notes |
|---|---|---|
| `n8n-nodes-base.function` | `n8n-nodes-base.code` | Function and FunctionItem nodes were removed in n8n 1.x. The Code node supports both "Run Once for All Items" and "Run Once for Each Item" modes. |
| `n8n-nodes-base.functionItem` | `n8n-nodes-base.code` (per-item mode) | Same node, different mode setting. |
| `n8n-nodes-base.start` | `n8n-nodes-base.manualTrigger` | The `Start` node was the original trigger; `Manual Trigger` replaced it. |
| `n8n-nodes-base.spreadsheetFile` | `n8n-nodes-base.convertToFile` or `n8n-nodes-base.extractFromFile` | Split into two specialized nodes; pick based on direction. |

## typeVersion drift

Several nodes have changed their parameter schema across `typeVersion` bumps. Common ones:

- **IF node v1 → v2+**: v1 used `conditions.boolean[].value1`, `conditions.string[].value1`. v2+ uses `conditions.options.combinator` and a `conditions.conditions[]` array with a different operator schema. If generating fresh, target the latest typeVersion (currently 2.2).
- **Webhook v1 → v2**: response handling changed. v2 has a separate `responseMode` and supports streaming.
- **HTTP Request v3 → v4**: auth and body parameter shapes changed. v4 has dedicated `sendQuery`, `sendHeaders`, `sendBody` toggles with structured parameter arrays.
- **Slack v1 → v2.x**: channel selector switched to `{ __rl: true, mode: "name" | "id" | "url", value: "..." }`.

## Import gotchas

- **Missing `typeVersion`** on any node → n8n refuses to import the whole workflow. Lint flags this as ERROR.
- **`httpRequest` with auth but no credential reference** → silently runs unauthenticated. Lint warns.
- **Webhook nodes without a `webhookId`** → n8n auto-generates one on import, so the production URL changes every time you re-import. Set `webhookId` to keep a stable URL.
- **Expression-based credential names** (`={{ $vars.X }}`) → not portable across instances; lint warns.
- **Credential names that don't exist on the target instance** → workflow loads but fails at runtime. There's no "find or create" — you must recreate credentials with identical names in the new instance.
- **AI Agent without `ai_languageModel` sub-node** → loads but fails on first execution with "no language model configured." Lint catches this as ERROR.

When in doubt, run `workflow.lint` against the JSON before returning it.
