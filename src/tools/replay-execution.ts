import { z } from "zod";

/**
 * Build a self-contained replay workflow that exercises a single node from
 * a larger workflow. Useful when iterating on one stubborn node — instead
 * of re-running the entire pipeline, pin the input and run that node in
 * isolation.
 *
 * Input modes:
 *   1. Provide `inputItems`: an array of `{ json: ... }` items to feed the
 *      node directly. A Code node is prepended that returns these items.
 *   2. Provide `execution`: the executed payload of the original workflow.
 *      We extract the output of the node feeding the target and use that
 *      as the input. Closest to "rerun this node with the actual data it
 *      saw last time".
 *   3. Neither: the replay workflow runs the target with an empty single
 *      `{}` item. Useful for trigger-less nodes that don't need input.
 */

export const replayExecutionInputSchema = {
	type: "object",
	properties: {
		workflow: {
			description:
				"The original n8n workflow JSON (parsed object or JSON string).",
			oneOf: [{ type: "object" }, { type: "string" }],
		},
		node: {
			type: "string",
			description: "The `name` of the node to replay.",
		},
		inputItems: {
			type: "array",
			description:
				"Optional explicit input items (each `{ json: ... }`). Overrides any execution-derived input.",
		},
		execution: {
			description:
				"Optional execution payload — used to pull the real input the target node saw last time.",
			oneOf: [{ type: "object" }, { type: "string" }],
		},
	},
	required: ["workflow", "node"],
} as const;

const inputZod = z.object({
	workflow: z.union([z.record(z.unknown()), z.string()]),
	node: z.string().min(1),
	inputItems: z.array(z.record(z.unknown())).optional(),
	execution: z.union([z.record(z.unknown()), z.string()]).optional(),
});

interface N8nNode {
	id: string;
	name: string;
	type: string;
	typeVersion: number;
	position: [number, number];
	parameters?: Record<string, unknown>;
	credentials?: Record<string, unknown>;
	disabled?: boolean;
}

export async function replayExecution(rawArgs: unknown) {
	const args = inputZod.parse(rawArgs);
	const wfRaw =
		typeof args.workflow === "string"
			? safeParse(args.workflow)
			: args.workflow;
	if (!wfRaw || typeof wfRaw !== "object" || Array.isArray(wfRaw)) {
		return errorResult("workflow is not a JSON object.");
	}
	const wf = wfRaw as Record<string, unknown>;
	const nodes = Array.isArray(wf.nodes) ? (wf.nodes as N8nNode[]) : [];
	const target = nodes.find((n) => n && n.name === args.node);
	if (!target) {
		return errorResult(
			`Node "${args.node}" not found in workflow. Available: ${nodes
				.map((n) => n?.name)
				.filter(Boolean)
				.join(", ")}`,
		);
	}

	let items: Array<Record<string, unknown>> | null = null;

	if (args.inputItems && args.inputItems.length > 0) {
		items = args.inputItems.map((j) => ({ json: j }));
	} else if (args.execution) {
		const exec =
			typeof args.execution === "string"
				? safeParse(args.execution)
				: args.execution;
		items = extractInputForNode(exec, wf, args.node);
	}

	if (!items) {
		items = [{ json: {} }];
	}

	const replayName = `[replay] ${(wf.name as string) ?? "workflow"} :: ${args.node}`;
	const tx = target.position?.[0] ?? 0;
	const ty = target.position?.[1] ?? 0;
	const seedNode = {
		id: "replay-seed",
		name: "Replay Seed",
		type: "n8n-nodes-base.code",
		typeVersion: 2,
		position: [tx - 250, ty],
		parameters: {
			mode: "runOnceForAllItems",
			jsCode: `return ${JSON.stringify(items, null, 2)};`,
		},
	};

	const triggerNode = {
		id: "replay-trigger",
		name: "Replay Trigger",
		type: "n8n-nodes-base.manualTrigger",
		typeVersion: 1,
		position: [tx - 500, ty],
		parameters: {},
	};

	const targetCopy: Record<string, unknown> = {
		...target,
		position: target.position ?? [0, 0],
	};

	const replay = {
		name: replayName,
		nodes: [triggerNode, seedNode, targetCopy],
		connections: {
			"Replay Trigger": {
				main: [[{ node: "Replay Seed", type: "main", index: 0 }]],
			},
			"Replay Seed": {
				main: [[{ node: target.name, type: "main", index: 0 }]],
			},
		},
		settings: (wf.settings as Record<string, unknown>) ?? {},
	};

	const note = items.length === 0
		? "Replay built but the seed has no items. The target node will not run."
		: `Replay workflow built. Trigger -> Replay Seed (${items.length} item${items.length === 1 ? "" : "s"}) -> ${args.node}. Import into n8n via the UI's 'Import from URL/file' or push via workflow.create.`;

	return {
		content: [
			{ type: "text" as const, text: `${note}\n\n${JSON.stringify(replay, null, 2)}` },
		],
		structuredContent: {
			workflow: replay,
			item_count: items.length,
			target_node: args.node,
		},
	};
}

function extractInputForNode(
	exec: unknown,
	wf: Record<string, unknown>,
	targetName: string,
): Array<Record<string, unknown>> | null {
	if (!exec || typeof exec !== "object") return null;
	const root = exec as Record<string, unknown>;
	const data = (root.data ?? root) as Record<string, unknown>;
	const resultData = (data.resultData ?? {}) as Record<string, unknown>;
	const runData = resultData.runData as Record<string, unknown> | undefined;
	if (!runData) return null;

	const connections = (wf.connections ?? {}) as Record<string, unknown>;
	const upstream: string[] = [];
	for (const [src, conf] of Object.entries(connections)) {
		const main = (conf as { main?: unknown[][] })?.main;
		if (!Array.isArray(main)) continue;
		for (const branch of main) {
			if (!Array.isArray(branch)) continue;
			for (const c of branch) {
				if (
					c &&
					typeof c === "object" &&
					(c as Record<string, unknown>).node === targetName
				) {
					upstream.push(src);
				}
			}
		}
	}
	if (upstream.length === 0) return null;

	const items: Array<Record<string, unknown>> = [];
	for (const src of upstream) {
		const runs = runData[src];
		if (!Array.isArray(runs)) continue;
		for (const run of runs) {
			if (!run || typeof run !== "object") continue;
			const main = ((run as Record<string, unknown>).data as Record<string, unknown>)
				?.main;
			if (!Array.isArray(main)) continue;
			for (const branch of main) {
				if (!Array.isArray(branch)) continue;
				for (const item of branch) {
					if (item && typeof item === "object" && "json" in item) {
						items.push(item as Record<string, unknown>);
					}
				}
			}
		}
	}
	return items.length > 0 ? items : null;
}

function safeParse(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

function errorResult(error: string) {
	return {
		content: [{ type: "text" as const, text: error }],
		structuredContent: { ok: false, error },
		isError: true,
	};
}
