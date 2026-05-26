import { z } from "zod";

/**
 * Semantic diff between two workflows. Compares nodes (added / removed /
 * modified by parameters or typeVersion), connections (added / removed),
 * and top-level settings. Ignores volatile fields (createdAt, updatedAt,
 * versionId, position deltas under a small threshold).
 */

export const diffWorkflowInputSchema = {
	type: "object",
	properties: {
		before: {
			description: "The 'before' workflow JSON (object or string).",
			oneOf: [{ type: "object" }, { type: "string" }],
		},
		after: {
			description: "The 'after' workflow JSON (object or string).",
			oneOf: [{ type: "object" }, { type: "string" }],
		},
	},
	required: ["before", "after"],
} as const;

const inputZod = z.object({
	before: z.union([z.record(z.unknown()), z.string()]),
	after: z.union([z.record(z.unknown()), z.string()]),
});

type NodeMap = Map<string, Record<string, unknown>>;

interface DiffEntry {
	kind:
		| "node_added"
		| "node_removed"
		| "node_modified"
		| "connection_added"
		| "connection_removed"
		| "setting_changed"
		| "active_changed"
		| "name_changed";
	node?: string;
	detail: string;
}

export async function diffWorkflow(rawArgs: unknown) {
	const args = inputZod.parse(rawArgs);
	const before = parse(args.before);
	const after = parse(args.after);
	if (!before) return errorResult("`before` is not a JSON object.");
	if (!after) return errorResult("`after` is not a JSON object.");

	const entries: DiffEntry[] = [];

	if (before.name !== after.name) {
		entries.push({
			kind: "name_changed",
			detail: `Workflow name: ${JSON.stringify(before.name)} -> ${JSON.stringify(after.name)}`,
		});
	}
	if (before.active !== after.active) {
		entries.push({
			kind: "active_changed",
			detail: `active: ${before.active} -> ${after.active}`,
		});
	}

	const beforeNodes = indexByName(before.nodes);
	const afterNodes = indexByName(after.nodes);

	for (const [name] of beforeNodes) {
		if (!afterNodes.has(name)) {
			entries.push({
				kind: "node_removed",
				node: name,
				detail: `Node "${name}" removed.`,
			});
		}
	}

	for (const [name, an] of afterNodes) {
		const bn = beforeNodes.get(name);
		if (!bn) {
			entries.push({
				kind: "node_added",
				node: name,
				detail: `Node "${name}" added (type ${String(an.type)}).`,
			});
			continue;
		}
		const changes = compareNodes(bn, an);
		for (const ch of changes) {
			entries.push({ kind: "node_modified", node: name, detail: ch });
		}
	}

	const beforeConns = flattenConnections(before.connections);
	const afterConns = flattenConnections(after.connections);

	for (const c of beforeConns) {
		if (!afterConns.has(c)) {
			entries.push({ kind: "connection_removed", detail: `Connection removed: ${c}` });
		}
	}
	for (const c of afterConns) {
		if (!beforeConns.has(c)) {
			entries.push({ kind: "connection_added", detail: `Connection added: ${c}` });
		}
	}

	const beforeSettings = (before.settings ?? {}) as Record<string, unknown>;
	const afterSettings = (after.settings ?? {}) as Record<string, unknown>;
	const settingKeys = new Set([
		...Object.keys(beforeSettings),
		...Object.keys(afterSettings),
	]);
	for (const k of settingKeys) {
		const a = beforeSettings[k];
		const b = afterSettings[k];
		if (!deepEqual(a, b)) {
			entries.push({
				kind: "setting_changed",
				detail: `settings.${k}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`,
			});
		}
	}

	const summary = summarize(entries);
	const text =
		entries.length === 0
			? "No semantic differences."
			: [summary, "", ...entries.map((e) => `- ${e.detail}`)].join("\n");

	return {
		content: [{ type: "text" as const, text }],
		structuredContent: {
			changes: entries,
			summary,
			change_count: entries.length,
		},
	};
}

function compareNodes(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): string[] {
	const changes: string[] = [];
	if (a.type !== b.type) {
		changes.push(`type: ${String(a.type)} -> ${String(b.type)}`);
	}
	if (a.typeVersion !== b.typeVersion) {
		changes.push(`typeVersion: ${a.typeVersion} -> ${b.typeVersion}`);
	}
	if (a.disabled !== b.disabled) {
		changes.push(`disabled: ${!!a.disabled} -> ${!!b.disabled}`);
	}
	if (!deepEqual(a.parameters ?? {}, b.parameters ?? {})) {
		changes.push("parameters changed");
	}
	if (!deepEqual(a.credentials ?? {}, b.credentials ?? {})) {
		changes.push("credentials changed");
	}
	const ap = Array.isArray(a.position) ? a.position : [0, 0];
	const bp = Array.isArray(b.position) ? b.position : [0, 0];
	if (Math.abs((ap[0] as number) - (bp[0] as number)) > 50 ||
		Math.abs((ap[1] as number) - (bp[1] as number)) > 50) {
		changes.push(`position: [${ap[0]}, ${ap[1]}] -> [${bp[0]}, ${bp[1]}]`);
	}
	return changes;
}

function indexByName(nodes: unknown): NodeMap {
	const map: NodeMap = new Map();
	if (!Array.isArray(nodes)) return map;
	for (const n of nodes) {
		if (n && typeof n === "object" && typeof (n as Record<string, unknown>).name === "string") {
			map.set((n as Record<string, unknown>).name as string, n as Record<string, unknown>);
		}
	}
	return map;
}

function flattenConnections(connections: unknown): Set<string> {
	const out = new Set<string>();
	if (!connections || typeof connections !== "object") return out;
	for (const [src, conf] of Object.entries(connections as Record<string, unknown>)) {
		if (!conf || typeof conf !== "object") continue;
		for (const [connType, branches] of Object.entries(conf as Record<string, unknown>)) {
			if (!Array.isArray(branches)) continue;
			branches.forEach((branch, branchIdx) => {
				if (!Array.isArray(branch)) return;
				for (const c of branch) {
					if (!c || typeof c !== "object") continue;
					const target = (c as Record<string, unknown>).node;
					if (typeof target === "string") {
						out.add(`${src} -[${connType}#${branchIdx}]-> ${target}`);
					}
				}
			});
		}
	}
	return out;
}

function summarize(entries: DiffEntry[]): string {
	if (entries.length === 0) return "No semantic differences.";
	const counts: Record<string, number> = {};
	for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
	const parts = Object.entries(counts)
		.map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
		.join(", ");
	return `${entries.length} change${entries.length === 1 ? "" : "s"}: ${parts}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i])) return false;
		}
		return true;
	}
	if (typeof a === "object" && typeof b === "object") {
		const ak = Object.keys(a as Record<string, unknown>);
		const bk = Object.keys(b as Record<string, unknown>);
		if (ak.length !== bk.length) return false;
		for (const k of ak) {
			if (!deepEqual(
				(a as Record<string, unknown>)[k],
				(b as Record<string, unknown>)[k],
			)) return false;
		}
		return true;
	}
	return false;
}

function parse(input: unknown): Record<string, unknown> | null {
	const v = typeof input === "string" ? safeParse(input) : input;
	if (!v || typeof v !== "object" || Array.isArray(v)) return null;
	return v as Record<string, unknown>;
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
