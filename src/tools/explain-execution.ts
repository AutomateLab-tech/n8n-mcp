import { z } from "zod";

export const explainExecutionInputSchema = {
	type: "object",
	properties: {
		execution: {
			description:
				"n8n execution object as either a parsed object or a JSON string. Accepts both the REST API shape (`{ data: { resultData: { runData, error, lastNodeExecuted } }, finished, status, ... }`) and the raw `executionData` body returned by the UI.",
			oneOf: [{ type: "object" }, { type: "string" }],
		},
	},
	required: ["execution"],
} as const;

const inputZod = z.object({
	execution: z.union([z.record(z.unknown()), z.string()]),
});

interface Finding {
	severity: "error" | "warning" | "info";
	node?: string;
	message: string;
	hint?: string;
}

export async function explainExecution(rawArgs: unknown) {
	const args = inputZod.parse(rawArgs);
	const exec =
		typeof args.execution === "string"
			? safeParse(args.execution)
			: args.execution;

	const findings: Finding[] = [];

	if (!exec || typeof exec !== "object" || Array.isArray(exec)) {
		findings.push({
			severity: "error",
			message: "Execution payload is not a JSON object.",
		});
		return formatResult(findings);
	}

	const root = exec as Record<string, unknown>;
	const data = pick(root, "data") ?? root;
	const resultData = pick(data, "resultData");
	if (!resultData || typeof resultData !== "object") {
		findings.push({
			severity: "error",
			message:
				"Execution has no `data.resultData`. This is not a complete n8n execution payload — re-export from the n8n UI ('Show details' -> 'Copy execution data') or the REST API (`GET /executions/:id?includeData=true`).",
		});
		return formatResult(findings);
	}
	const rd = resultData as Record<string, unknown>;
	const runData = rd.runData;
	const lastNode =
		typeof rd.lastNodeExecuted === "string" ? rd.lastNodeExecuted : undefined;
	const topError = rd.error;

	const status = pickString(root, "status");
	const finished = root.finished === true;
	const mode = pickString(root, "mode");

	if (status === "running" || (!finished && status !== "error")) {
		findings.push({
			severity: "warning",
			message:
				"Execution is not finished. Wait for it to complete before diagnosing — partial run data can look like a node 'silently dropped items' when it just hasn't run yet.",
		});
	}

	if (topError && typeof topError === "object") {
		const e = topError as Record<string, unknown>;
		const msg = pickString(e, "message") ?? "(no message)";
		const node = pickString(e, "node") ?? lastNode;
		findings.push({
			severity: "error",
			node,
			message: `Workflow-level error: ${msg}`,
			hint: hintForError(msg),
		});
	}

	if (!runData || typeof runData !== "object") {
		findings.push({
			severity: "warning",
			message:
				"No `runData` present. The workflow probably failed before any node ran (trigger error or invalid expression in workflow settings).",
		});
		return formatResult(findings);
	}

	const runDataObj = runData as Record<string, unknown>;
	const nodeNames = Object.keys(runDataObj);
	if (nodeNames.length === 0) {
		findings.push({
			severity: "warning",
			message: "`runData` is empty. No nodes executed.",
		});
		return formatResult(findings);
	}

	for (const nodeName of nodeNames) {
		const runs = runDataObj[nodeName];
		if (!Array.isArray(runs)) continue;
		analyseNode(nodeName, runs, findings, mode);
	}

	if (lastNode && !findings.some((f) => f.node === lastNode)) {
		findings.push({
			severity: "info",
			node: lastNode,
			message: `Last node executed was "${lastNode}". If the workflow stopped here unexpectedly, check its output items below.`,
		});
	}

	if (findings.length === 0) {
		findings.push({
			severity: "info",
			message: "No problems detected. Execution finished cleanly.",
		});
	}

	return formatResult(findings);
}

function analyseNode(
	nodeName: string,
	runs: unknown[],
	findings: Finding[],
	mode: string | undefined,
) {
	for (let runIdx = 0; runIdx < runs.length; runIdx++) {
		const run = runs[runIdx];
		if (!run || typeof run !== "object") continue;
		const r = run as Record<string, unknown>;

		if (r.error && typeof r.error === "object") {
			const e = r.error as Record<string, unknown>;
			const message = pickString(e, "message") ?? "(no message)";
			const description = pickString(e, "description");
			findings.push({
				severity: "error",
				node: nodeName,
				message: description ? `${message} - ${description}` : message,
				hint: hintForError(message),
			});
			continue;
		}

		const nodeData = r.data;
		const main = pickArray(nodeData, "main");
		const ai = collectAiOutputs(nodeData);

		if (!main && ai.length === 0) {
			findings.push({
				severity: "warning",
				node: nodeName,
				message:
					"Ran but produced no output. Likely a no-op or upstream gave it nothing to iterate on.",
			});
			continue;
		}

		if (main && main.length > 0) {
			let totalItems = 0;
			for (const branch of main) {
				if (Array.isArray(branch)) totalItems += branch.length;
			}
			if (totalItems === 0) {
				findings.push({
					severity: "warning",
					node: nodeName,
					message:
						runs.length > 1
							? `Run #${runIdx + 1} returned 0 items.`
							: "Returned 0 items. Downstream nodes will not execute.",
					hint:
						"Common causes: (1) IF/Switch routed to the other branch — check `parameters.conditions`. (2) Filter/Set node dropped everything — inspect its output explicitly. (3) Code node returned `[]` or `null` instead of an array of `{ json: ... }` objects.",
				});
			}

			const firstItem = firstJson(main);
			if (firstItem && hasUnresolvedExpression(firstItem)) {
				findings.push({
					severity: "warning",
					node: nodeName,
					message:
						"Output contains an unresolved `={{ ... }}` expression. n8n stored the literal expression instead of evaluating it.",
					hint:
						"Almost always: (1) referenced node hadn't run yet for this item — fix the workflow order. (2) `$json.foo` accessed when `foo` was undefined — pre-check with `$json.foo ?? 'fallback'`. (3) typo in `$('Node Name')` — node names are case-sensitive.",
				});
			}
		}

		for (const aiOut of ai) {
			const tokens = extractTokens(aiOut);
			if (tokens) {
				findings.push({
					severity: "info",
					node: nodeName,
					message: `LLM call: ${tokens.input ?? "?"} input + ${
						tokens.output ?? "?"
					} output tokens${tokens.model ? ` (${tokens.model})` : ""}.`,
				});
			}
		}
	}

	if (mode === "manual" && runs.length === 0) {
		findings.push({
			severity: "warning",
			node: nodeName,
			message:
				"Node is in `runData` but has no runs. n8n usually prunes these — check whether you're looking at a partial test run.",
		});
	}
}

function pick(obj: unknown, key: string): unknown {
	if (!obj || typeof obj !== "object") return undefined;
	return (obj as Record<string, unknown>)[key];
}

function pickString(obj: unknown, key: string): string | undefined {
	const v = pick(obj, key);
	return typeof v === "string" ? v : undefined;
}

function pickArray(obj: unknown, key: string): unknown[] | undefined {
	const v = pick(obj, key);
	return Array.isArray(v) ? v : undefined;
}

function collectAiOutputs(nodeData: unknown): unknown[][] {
	if (!nodeData || typeof nodeData !== "object") return [];
	const out: unknown[][] = [];
	for (const [k, v] of Object.entries(nodeData as Record<string, unknown>)) {
		if (k === "main") continue;
		if (k.startsWith("ai_") && Array.isArray(v)) {
			for (const branch of v) {
				if (Array.isArray(branch)) out.push(branch);
			}
		}
	}
	return out;
}

function firstJson(main: unknown[]): Record<string, unknown> | undefined {
	for (const branch of main) {
		if (!Array.isArray(branch)) continue;
		for (const item of branch) {
			if (item && typeof item === "object" && "json" in item) {
				const j = (item as Record<string, unknown>).json;
				if (j && typeof j === "object" && !Array.isArray(j)) {
					return j as Record<string, unknown>;
				}
			}
		}
	}
	return undefined;
}

function hasUnresolvedExpression(obj: Record<string, unknown>): boolean {
	for (const v of Object.values(obj)) {
		if (typeof v === "string" && /^=\{\{.*\}\}/.test(v)) return true;
		if (v && typeof v === "object" && !Array.isArray(v)) {
			if (hasUnresolvedExpression(v as Record<string, unknown>)) return true;
		}
	}
	return false;
}

function extractTokens(branch: unknown[]): {
	input?: number;
	output?: number;
	model?: string;
} | null {
	for (const item of branch) {
		if (!item || typeof item !== "object") continue;
		const j = (item as Record<string, unknown>).json;
		if (!j || typeof j !== "object") continue;
		const jo = j as Record<string, unknown>;
		const tokenUsage = (jo.tokenUsage ?? jo.usage) as
			| Record<string, unknown>
			| undefined;
		if (tokenUsage && typeof tokenUsage === "object") {
			const input =
				(tokenUsage.promptTokens as number) ??
				(tokenUsage.input_tokens as number) ??
				(tokenUsage.inputTokens as number);
			const output =
				(tokenUsage.completionTokens as number) ??
				(tokenUsage.output_tokens as number) ??
				(tokenUsage.outputTokens as number);
			const model =
				(jo.model as string) ?? (tokenUsage.model as string) ?? undefined;
			if (typeof input === "number" || typeof output === "number") {
				return { input, output, model };
			}
		}
	}
	return null;
}

function hintForError(msg: string): string | undefined {
	const m = msg.toLowerCase();
	if (m.includes("cannot read") && m.includes("undefined")) {
		return "Expression accessed a property on `undefined`. Add `?.` chains or `?? fallback`. The most common case: assuming an upstream item exists when the previous node returned 0 items.";
	}
	if (m.includes("is not defined")) {
		return "Likely typo in `$('Node Name')` — node references are case-sensitive and use the exact `name` field, not the `displayName`.";
	}
	if (m.includes("invalid json") || m.includes("unexpected token")) {
		return "JSON.parse failed. Check the upstream payload format: HTTP nodes can return text/HTML on errors; gate with `$response.statusCode === 200` first.";
	}
	if (m.includes("rate limit") || m.includes("429")) {
		return "Add a Loop Over Items (Split In Batches) node with batch size 1 and a Wait node, or enable retries on the failing node (Settings tab).";
	}
	if (m.includes("authentication") || m.includes("401") || m.includes("403")) {
		return "Credential is missing, expired, or has the wrong scopes. Re-create in n8n's Credentials tab and verify the node's `credentials` block names it exactly.";
	}
	if (m.includes("missing") && m.includes("required")) {
		return "A required parameter on the node is empty or evaluated to undefined. Check the node config and any expressions feeding it.";
	}
	if (m.includes("function") && m.includes("not a function")) {
		return "Code node: you probably called something that's not in the sandbox. Allowed: standard JS, `$input`, `$json`, `$node`, `$workflow`. NOT allowed: `require()`, `fetch()` (use HTTP Request node), `this.getCredentials()`.";
	}
	return undefined;
}

function safeParse(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

function formatResult(findings: Finding[]) {
	const lines = findings.map((f) => {
		const tag = f.severity.toUpperCase();
		const where = f.node ? `[${f.node}] ` : "";
		const main = `${tag} ${where}${f.message}`;
		return f.hint ? `${main}\n  hint: ${f.hint}` : main;
	});
	const error_count = findings.filter((f) => f.severity === "error").length;
	const warning_count = findings.filter((f) => f.severity === "warning").length;
	return {
		content: [{ type: "text" as const, text: lines.join("\n\n") }],
		structuredContent: { findings, error_count, warning_count },
	};
}
