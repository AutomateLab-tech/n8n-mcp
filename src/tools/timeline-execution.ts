import { z } from "zod";

/**
 * Render an execution as a per-node timeline: start offset, duration,
 * items in/out, error flag. Complements execution.explain — that one
 * surfaces *why* things broke; this one surfaces *when*.
 */

export const timelineExecutionInputSchema = {
	type: "object",
	properties: {
		execution: {
			description:
				"n8n execution payload (parsed object or JSON string). Must include `data.resultData.runData`.",
			oneOf: [{ type: "object" }, { type: "string" }],
		},
	},
	required: ["execution"],
} as const;

const inputZod = z.object({
	execution: z.union([z.record(z.unknown()), z.string()]),
});

interface TimelineRow {
	node: string;
	run_index: number;
	start_ms: number;
	duration_ms: number;
	items_in: number | null;
	items_out: number;
	had_error: boolean;
	error_message: string | null;
}

export async function timelineExecution(rawArgs: unknown) {
	const args = inputZod.parse(rawArgs);
	const exec =
		typeof args.execution === "string"
			? safeParse(args.execution)
			: args.execution;

	if (!exec || typeof exec !== "object" || Array.isArray(exec)) {
		return errorResult("Execution payload is not a JSON object.");
	}

	const root = exec as Record<string, unknown>;
	const data = (root.data ?? root) as Record<string, unknown>;
	const resultData = (data.resultData ?? {}) as Record<string, unknown>;
	const runData = resultData.runData as Record<string, unknown> | undefined;

	if (!runData) {
		return errorResult(
			"Execution has no `data.resultData.runData`. Re-export with `includeData=true`.",
		);
	}

	const rows: TimelineRow[] = [];
	let minStart = Number.POSITIVE_INFINITY;

	for (const [nodeName, runs] of Object.entries(runData)) {
		if (!Array.isArray(runs)) continue;
		for (let i = 0; i < runs.length; i++) {
			const r = runs[i] as Record<string, unknown> | null;
			if (!r || typeof r !== "object") continue;
			const startTime =
				typeof r.startTime === "number"
					? r.startTime
					: typeof r.executionTime === "number"
						? r.executionTime
						: 0;
			const duration =
				typeof r.executionTime === "number" ? r.executionTime : 0;
			minStart = Math.min(minStart, startTime);

			let itemsOut = 0;
			const main = ((r.data as Record<string, unknown>)?.main as unknown[]) ?? [];
			for (const branch of main) {
				if (Array.isArray(branch)) itemsOut += branch.length;
			}

			const inputs =
				(r.source as Array<{ previousNode?: string; previousNodeOutput?: number }>) ??
				[];
			let itemsIn: number | null = null;
			if (inputs.length > 0) {
				itemsIn = 0;
				for (const src of inputs) {
					const upRuns = runData[src.previousNode ?? ""];
					if (!Array.isArray(upRuns)) continue;
					for (const up of upRuns) {
						const upMain = ((up as Record<string, unknown>)?.data as Record<string, unknown>)
							?.main as unknown[] | undefined;
						if (!Array.isArray(upMain)) continue;
						const outIdx = src.previousNodeOutput ?? 0;
						const branch = upMain[outIdx];
						if (Array.isArray(branch)) itemsIn += branch.length;
					}
				}
			}

			const errObj = r.error as Record<string, unknown> | undefined;
			const errMsg =
				errObj && typeof errObj === "object" && typeof errObj.message === "string"
					? errObj.message
					: null;

			rows.push({
				node: nodeName,
				run_index: i,
				start_ms: startTime,
				duration_ms: duration,
				items_in: itemsIn,
				items_out: itemsOut,
				had_error: !!errObj,
				error_message: errMsg,
			});
		}
	}

	rows.sort((a, b) => a.start_ms - b.start_ms);
	if (minStart === Number.POSITIVE_INFINITY) minStart = 0;
	for (const r of rows) r.start_ms = r.start_ms - minStart;

	const totalMs =
		rows.length > 0
			? Math.max(...rows.map((r) => r.start_ms + r.duration_ms))
			: 0;

	const table = renderMarkdown(rows, totalMs);

	return {
		content: [{ type: "text" as const, text: table }],
		structuredContent: {
			rows,
			total_ms: totalMs,
			row_count: rows.length,
		},
	};
}

function renderMarkdown(rows: TimelineRow[], totalMs: number): string {
	if (rows.length === 0) return "No nodes executed.";
	const header = `| Node | Start (ms) | Duration (ms) | In | Out | Status |\n|---|---:|---:|---:|---:|---|`;
	const body = rows
		.map((r) => {
			const status = r.had_error
				? `ERR: ${r.error_message ?? ""}`
				: r.items_out === 0
					? "0 items"
					: "ok";
			const inStr = r.items_in === null ? "-" : String(r.items_in);
			const suffix = r.run_index > 0 ? ` (run ${r.run_index + 1})` : "";
			return `| ${r.node}${suffix} | ${r.start_ms} | ${r.duration_ms} | ${inStr} | ${r.items_out} | ${status} |`;
		})
		.join("\n");
	const totalLine = `\n\nTotal: ${totalMs} ms across ${rows.length} node-run${rows.length === 1 ? "" : "s"}.`;
	return `${header}\n${body}${totalLine}`;
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
