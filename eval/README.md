# n8n-mcp Eval Suite

Golden-workflow regression suite for the `workflow.lint` tool. Each fixture pair (workflow + expected) pins a specific lint rule so regressions are caught immediately.

## Directory Layout

```
eval/
  workflows/   — n8n workflow JSON files (minimal but realistic)
  expected/    — expected lintWorkflow() structuredContent output
```

## Running the Suite

The suite has no dedicated test runner yet. Use the MCP tool directly or the Node.js snippet below.

### Manual check via Node.js

```js
import { readFileSync, readdirSync } from "fs";
import { lintWorkflow } from "./src/tools/lint-workflow.js";

const dir = "./eval/workflows";
let pass = 0, fail = 0;

for (const file of readdirSync(dir).filter(f => f.endsWith(".json"))) {
  const workflow = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
  const expectedPath = `./eval/expected/${file}`;
  const expected = JSON.parse(readFileSync(expectedPath, "utf8"));

  const result = await lintWorkflow({ workflow });
  const actual = result.structuredContent;

  const ok =
    actual.error_count === expected.error_count &&
    actual.warning_count === expected.warning_count &&
    actual.issues.length === expected.issues.length;

  if (ok) {
    console.log(`PASS  ${file}`);
    pass++;
  } else {
    console.error(`FAIL  ${file}`);
    console.error("  expected:", JSON.stringify(expected, null, 2));
    console.error("  actual:  ", JSON.stringify(actual, null, 2));
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
```

## Coverage Map

Each workflow file exercises a specific rule (or confirms a clean pass). The `expected/` file specifies the exact `structuredContent` shape returned by `lintWorkflow`.

| Workflow file | Rule exercised | Expected outcome |
|---|---|---|
| `valid-simple.json` | 2-node happy path (ManualTrigger → Set) | 0 errors, 0 warnings |
| `valid-ai-agent.json` | AI Agent wired with LLM + memory | 0 errors, 0 warnings |
| `err-deprecated.json` | `n8n-nodes-base.function` is deprecated | 0 errors, 1 warning (deprecated node) |
| `err-no-credentials.json` | Slack node with no credentials object | 0 errors, 1 warning (missing credential) |
| `err-broken-connections.json` | Connection targeting a node that doesn't exist | 1 error (missing target), 0 warnings |
| `err-duplicate-names.json` | Two nodes share the same name | 1 error (duplicate name), 0 warnings |
| `err-missing-typeversion.json` | Node with no `typeVersion` field | 1 error (missing typeVersion), 0 warnings |
| `warn-webhook-no-id.json` | Webhook node without a `webhookId` | 0 errors, 1 warning (unstable URL) |
| `warn-if-v1-conditions.json` | IF node using v1 `conditions.string[]` schema | 0 errors, 1 warning (v1 schema) |
| `warn-expression-bad-ref.json` | Expression `$('Fetch User')` — node doesn't exist | 1 error (stale ref), 0 warnings |
| `warn-http-no-error-path.json` | HTTP Request POST with no body configured | 0 errors, 1 warning (missing body) |
| `warn-schedule-no-timezone.json` | Schedule trigger with `triggerAtHour` and no timezone | 0 errors, 1 warning (missing timezone) |

## Workflow Format

Every workflow JSON follows the standard n8n export shape:

```json
{
  "name": "...",
  "nodes": [
    {
      "id": "<uuid>",
      "name": "...",
      "type": "n8n-nodes-base.<type>",
      "typeVersion": 1,
      "position": [x, y],
      "parameters": {}
    }
  ],
  "connections": {
    "<Source Node Name>": {
      "main": [[{ "node": "<Target Node Name>", "type": "main", "index": 0 }]]
    }
  },
  "settings": {},
  "staticData": null
}
```

## Expected Result Format

Each `expected/*.json` matches the `structuredContent` field of the `lintWorkflow` return value:

```json
{
  "issues": [
    {
      "severity": "error" | "warning",
      "node": "<node name>",
      "message": "<exact message string>"
    }
  ],
  "error_count": 0,
  "warning_count": 0
}
```

The `node` field is omitted for workflow-level issues (e.g. broken connection targets where the source node name appears in the message).

## Adding New Fixtures

1. Drop a workflow JSON in `eval/workflows/`.
2. Trace through `src/tools/lint-workflow.ts` to predict the output, or run the Node.js snippet above with a temporary placeholder `expected/` file.
3. Write the expected JSON in `eval/expected/` with the same filename.
4. Verify the suite passes before committing.

## Lint Rules Reference

The following rules are implemented in `src/tools/lint-workflow.ts`:

- **Deprecated node types** — warns when using `n8n-nodes-base.function`, `functionItem`, `start`, or `spreadsheetFile`
- **Missing credentials** — warns when a credential-required node (Slack, Gmail, Notion, etc.) has no `credentials` object
- **AI Agent without LLM** — errors when an agent node has no `ai_languageModel` sub-node connected
- **Webhook without webhookId** — warns that the production URL will change on re-import
- **Duplicate node names** — errors when two nodes share the same `name`
- **Missing/invalid typeVersion** — errors when `typeVersion` is absent or not a number
- **Broken connections** — errors when a connection points to a node name not in the `nodes` array
- **Stale expression references** — errors when `$('Node Name')` references a node that doesn't exist
- **IF node v1 conditions** — warns when `conditions.boolean[]` / `conditions.string[]` shape is detected
- **Schedule trigger without timezone** — warns when `triggerAtHour` is used without `settings.timezone`
- **HTTP Request body mismatch** — warns on GET-with-body or POST/PUT/PATCH-without-body
- **Rate-sensitive node without retry** — warns when Slack, OpenAI, Gmail, etc. has neither `retryOnFail` nor `continueOnFail`
- **Empty Set node** — warns when a Set node has no values configured
- **Disabled node with downstream** — warns when a disabled node still has outgoing connections
- **Manual trigger in active workflow** — warns when a manual trigger is wired in an active workflow
