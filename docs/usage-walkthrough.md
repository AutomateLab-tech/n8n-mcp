# Debug a workflow with recorded JSON

Export the workflow and remove credential values before sharing it. Keep node names, connection names and `typeVersion` fields: the lint rules need those relationships.

Call `workflow_lint` with a parsed `workflow` object or its JSON string. Start with a manual trigger whose `parameters` is an empty object and whose `connections` is empty. Then test a connection pointing at a nonexistent node. The second case should identify the broken connection; do not rename a real node just to silence the message.

For an execution, call `execution_explain` with the `execution` object. It accepts the API wrapper containing `data.resultData.runData` and the UI execution-data shape. Keep the actual failing node's output or error, with secrets removed. Use `execution_timeline` to inspect order and `workflow_diff` to compare the last working export with the failing version.

These inspections do not need to activate a workflow. Before using `workflow_create` or `workflow_activate`, configure the intended instance and review the exact change. Verify a repair with the failing input, a different input that exercises the same node, and a valid neighboring case.
