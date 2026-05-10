---
name: n8n
description: Use when the user wants to build, debug, or extend an n8n workflow - generating workflow JSON from a description, scaffolding a custom TypeScript node, building an AI agent (LangChain cluster), iterating over items, writing Code-node JS, or linting an existing workflow for missing credentials, deprecated node types, broken connections, and bad return shapes.
---

# n8n

This skill pairs with the `@automatelab/n8n-mcp` server. It gives you three tools and the n8n-specific context you need to produce output that imports cleanly and runs on the first try.

## When to use which tool

- **`n8n_generate_workflow`** - the user describes a flow in plain English ("Stripe webhook to Slack and a Google Sheets row"). Returns workflow JSON ready for n8n's "Import from File" dialog.
- **`n8n_scaffold_node`** - the user wants a *custom* node (one not in n8n's library, or a thin wrapper around an internal API). Returns a single `INodeType` TypeScript file.
- **`n8n_lint_workflow`** - the user pastes existing workflow JSON, OR you just generated one. Catches missing `typeVersion`, deprecated types, missing credentials, broken connections, duplicate IDs.

Default chain: `generate_workflow` -> `lint_workflow` on the result. Hand back the JSON only if lint reports no issues, or call out the warnings explicitly.

## The n8n data model: items and auto-iteration

This is the single biggest source of broken workflows. Every node sees an array:

```
[ { json: { ... }, binary?: { ... } }, { json: { ... } }, ... ]
```

Most nodes **auto-iterate**: they run once *per item*. You almost never need an explicit loop. If a previous node returned 10 items, the next node executes 10 times automatically.

Expression cheat sheet (use inside `={{ ... }}`):

- `$json` - the *current* item's `json` payload (most common)
- `$json.field.nested` - dot-walk into the current item
- `$input.all()` - full array of items entering this node
- `$input.first()` / `$input.last()` - shortcuts
- `$("Node Name").item.json` - the matching item from another node (paired by run index)
- `$("Node Name").all()` - all items from another node, regardless of pairing
- `$("Node Name").first().json` - first item from another node
- `$node["Node Name"].json` - legacy syntax, still works but `$()` is preferred

Common mistake: writing `$json[0]` because you saw a JSON array in the input panel. The array IS the item list - n8n already split it. Use `$json` (singular) and trust auto-iteration.

## Iteration: do you actually need a loop?

Decision tree:

1. **Default: no loop.** Drop a Set / HTTP Request / Code node after your data source and it'll run per item.
2. **Need a loop only for:**
   - Paged API calls (loop while `nextCursor` is set)
   - Rate-limited APIs that need batching with delay
   - Sequential side-effects where order matters and you must process N at a time
3. **Picking the right node:**
   - **Split Out** - one item contains an array field (e.g. `items[]`); flatten so each array element becomes its own item. Use this 90% of the time you "need to iterate over an array."
   - **Loop Over Items (Split In Batches)** - actual loop with a configurable batch size and a back-edge connection. Use for pagination and rate-limited batching.
   - **Aggregate** - inverse of Split Out: collapse N items back into a single item with an array field.

Loop Over Items requires connecting the *processing* branch's last node back to the loop node's main input. Without that back-edge, it runs once and stops. Lint won't catch this; double-check connections.

## AI Agent / LangChain cluster nodes

n8n's AI nodes use a different connection model. The root is `n8n-nodes-langchain.agent`. Sub-nodes attach *upward* via specialized connection types, not the normal `main` flow:

| Sub-node role | Connection type | Examples |
|---|---|---|
| Language model | `ai_languageModel` | `lmChatOpenAi`, `lmChatAnthropic`, `lmChatOllama` |
| Memory | `ai_memory` | `memoryBufferWindow`, `memoryPostgresChat` |
| Tools | `ai_tool` | `toolHttpRequest`, `toolCode`, `toolWorkflow`, MCP client |
| Output parser | `ai_outputParser` | `outputParserStructured` |

In `connections`, the *sub-node* is the source and the agent is the target, with the connection type set:

```json
"connections": {
  "OpenAI Chat Model": {
    "ai_languageModel": [[{ "node": "AI Agent", "type": "ai_languageModel", "index": 0 }]]
  },
  "Buffer Window Memory": {
    "ai_memory": [[{ "node": "AI Agent", "type": "ai_memory", "index": 0 }]]
  }
}
```

Minimum viable agent: trigger -> AI Agent (root) + a chat model sub-node + (optional) memory + (optional) tools. The agent itself flows downstream via `main`.

Tool nodes can wrap arbitrary HTTP requests, sub-workflows, or Code. To call other workflows from an agent, use `toolWorkflow` and reference the sub-workflow's ID.

## Code node: return shape contract

The Code node MUST return an array of items, never a raw object. This is the #1 reason Code nodes "fail mysteriously."

Run Once for All Items (default mode):
```js
const out = [];
for (const item of $input.all()) {
  out.push({ json: { ...item.json, doubled: item.json.value * 2 } });
}
return out;
```

Run Once for Each Item:
```js
return { json: { ...$json, doubled: $json.value * 2 } };
```

Note the difference: per-all-items returns an *array*; per-each-item returns a *single item object*. n8n collects them.

What breaks:
- `return $json` - returns one item's payload, not wrapped (per-each-item: missing `json` key; per-all-items: not an array)
- `return [...]` of plain objects without `{ json: ... }` wrapping
- Calling `this.getCredentials()` or `$getCredentials()` - not available in Code node, use `$credentials.<name>` only inside expressions on credential-aware nodes

## Workflow JSON conventions

Every node MUST have:
- `id` - unique UUID per workflow
- `name` - unique display name (connections key by name, not id)
- `type` - e.g. `n8n-nodes-base.slack`, `n8n-nodes-base.webhook`
- `typeVersion` - integer or float; n8n refuses to load a node without one
- `position` - `[x, y]` array (canvas coordinates, ~220px apart horizontally)
- `parameters` - object, can be empty `{}`

`connections` is keyed by source node *name*. Each entry: `{ "main": [[{ "node": "<target name>", "type": "main", "index": 0 }]] }`. The double array is real - first level is output index, second is fan-out targets.

Credentials: nodes like `slack`, `gmail`, `googleSheets`, `notion`, `discord`, `stripe`, `httpRequest` (with auth) need a `credentials` block referencing a credential by name. The user creates the credential in n8n's UI; the workflow JSON only references it. Credential names are NOT portable across instances - if you import to a new n8n, recreate credentials with identical names or the workflow will fail at runtime.

## Custom node skeleton

A scaffolded node implements `INodeType`:
- `description: INodeTypeDescription` - displayName, name, group, version, description, defaults, inputs/outputs, credentials, properties
- `async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>` - read inputs via `this.getInputData()`, return `[outputs]` (outer array is per output index)

Drop the file into `nodes/<NodeName>/<nodeName>.node.ts` of a custom n8n package, register in `package.json` `n8n.nodes`, rebuild.

## Import gotchas and deprecations

Lint flags these; you should avoid producing them:

- `n8n-nodes-base.function` -> `n8n-nodes-base.code` (Function and FunctionItem nodes were removed)
- `n8n-nodes-base.spreadsheetFile` -> `n8n-nodes-base.convertToFile` / `extractFromFile`
- Missing `typeVersion` on any node - n8n refuses to import
- `httpRequest` with auth but no credential reference - silently runs unauthenticated
- IF node v1 syntax (`conditions.boolean[].value1` etc.) - v2+ uses `conditions.options.combinator` and a different operator schema; if generating fresh, target the latest typeVersion
- Expression-based credential names - not portable across instances; lint warns but lets it through
- Webhook nodes without a `webhookId` - n8n auto-generates on import, but be explicit if the user needs a stable URL

When in doubt, run `n8n_lint_workflow` against the JSON before returning it.
