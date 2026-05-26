import { z } from "zod";
import {
	checkWorkflowAllowed,
	getAllowedTags,
	getAllowedWorkflowIds,
} from "../policy.js";

/**
 * REST tools that talk to a live n8n instance.
 *
 * Auth is read from the environment so the user doesn't paste API keys into
 * chat. They must set:
 *   N8N_API_URL   - e.g. https://n8n.example.com (no trailing /api/v1)
 *   N8N_API_KEY   - n8n personal API key (Settings -> API)
 *
 * If either is missing, every tool returns a clear "not configured" message
 * instead of throwing — keeps the MCP server usable in stateless mode.
 */

interface ApiConfig {
	baseUrl: string;
	apiKey: string;
}

function getConfig(): ApiConfig | { error: string } {
	const url = process.env.N8N_API_URL?.trim();
	const key = process.env.N8N_API_KEY?.trim();
	if (!url || !key) {
		return {
			error:
				"n8n REST tools are not configured. Set N8N_API_URL (e.g. https://n8n.example.com) and N8N_API_KEY (n8n -> Settings -> API) in the MCP server's environment. The other 4 tools (generate, lint, scaffold, explain) work without these.",
		};
	}
	const trimmed = url.replace(/\/$/, "").replace(/\/api\/v1$/, "");
	return { baseUrl: `${trimmed}/api/v1`, apiKey: key };
}

async function call(
	cfg: ApiConfig,
	method: string,
	path: string,
	body?: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
	let res: Response;
	try {
		res = await fetch(`${cfg.baseUrl}${path}`, {
			method,
			headers: {
				"X-N8N-API-KEY": cfg.apiKey,
				accept: "application/json",
				...(body ? { "content-type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		});
	} catch (err) {
		return {
			ok: false,
			error: `Network error calling ${method} ${path}: ${
				(err as Error).message
			}. Verify N8N_API_URL is reachable from this machine.`,
		};
	}
	const text = await res.text();
	if (!res.ok) {
		const snippet = text.slice(0, 400);
		return {
			ok: false,
			error: `${method} ${path} -> ${res.status} ${res.statusText}: ${snippet}`,
		};
	}
	if (text.length === 0) return { ok: true, data: null };
	try {
		return { ok: true, data: JSON.parse(text) };
	} catch {
		return { ok: true, data: text };
	}
}

function textResult(text: string, structured?: Record<string, unknown>) {
	if (structured === undefined) {
		return { content: [{ type: "text" as const, text }] };
	}
	return {
		content: [{ type: "text" as const, text }],
		structuredContent: structured,
	};
}

function jsonResult(data: unknown, structured?: Record<string, unknown>) {
	return textResult(JSON.stringify(data, null, 2), structured);
}

function errorResult(error: string) {
	return {
		content: [{ type: "text" as const, text: error }],
		structuredContent: { ok: false, error },
		isError: true,
	};
}

// ---------------------------------------------------------------------------
// workflow.list
// ---------------------------------------------------------------------------

export const listWorkflowsInputSchema = {
	type: "object",
	properties: {
		active: {
			type: "boolean",
			description: "Filter by active status. Omit to return both.",
		},
		tags: {
			type: "string",
			description: "Comma-separated tag names to filter by.",
		},
		name: {
			type: "string",
			description: "Filter by exact workflow name.",
		},
		limit: {
			type: "number",
			description: "Page size (n8n default: 100, max: 250).",
		},
	},
} as const;

const listWorkflowsZod = z.object({
	active: z.boolean().optional(),
	tags: z.string().optional(),
	name: z.string().optional(),
	limit: z.number().int().positive().max(250).optional(),
});

export async function listWorkflows(rawArgs: unknown) {
	const cfg = getConfig();
	if ("error" in cfg) return errorResult(cfg.error);
	const args = listWorkflowsZod.parse(rawArgs ?? {});
	const params = new URLSearchParams();
	if (args.active !== undefined) params.set("active", String(args.active));
	if (args.tags) params.set("tags", args.tags);
	if (args.name) params.set("name", args.name);
	if (args.limit) params.set("limit", String(args.limit));
	const qs = params.toString() ? `?${params}` : "";
	const r = await call(cfg, "GET", `/workflows${qs}`);
	if (!r.ok) return errorResult(r.error);
	const data = r.data as { data?: unknown[] } | unknown[];
	const arr = Array.isArray(data) ? data : data?.data ?? [];
	let workflows = (arr as Array<Record<string, unknown>>).map((w) => ({
		id: w.id,
		name: w.name,
		active: w.active,
		nodeCount: Array.isArray(w.nodes) ? (w.nodes as unknown[]).length : undefined,
		updatedAt: w.updatedAt,
		tags: Array.isArray(w.tags)
			? (w.tags as Array<{ name?: string }>).map((t) => t.name).filter(Boolean)
			: undefined,
	}));
	const allowedIds = getAllowedWorkflowIds();
	if (allowedIds) {
		workflows = workflows.filter((w) => allowedIds.has(String(w.id)));
	}
	const allowedTags = getAllowedTags();
	if (allowedTags) {
		workflows = workflows.filter((w) =>
			(w.tags ?? []).some((t): t is string =>
				typeof t === "string" && allowedTags.has(t),
			),
		);
	}
	return jsonResult(workflows, { workflows, count: workflows.length });
}

// ---------------------------------------------------------------------------
// workflow.get
// ---------------------------------------------------------------------------

export const getWorkflowInputSchema = {
	type: "object",
	properties: {
		id: { type: "string", description: "Workflow ID." },
	},
	required: ["id"],
} as const;

const getWorkflowZod = z.object({ id: z.string().min(1) });

export async function getWorkflow(rawArgs: unknown) {
	const cfg = getConfig();
	if ("error" in cfg) return errorResult(cfg.error);
	const args = getWorkflowZod.parse(rawArgs);
	const denied = checkWorkflowAllowed(args.id);
	if (denied) return errorResult(denied);
	const r = await call(cfg, "GET", `/workflows/${encodeURIComponent(args.id)}`);
	if (!r.ok) return errorResult(r.error);
	const wf = (r.data ?? {}) as Record<string, unknown>;
	return jsonResult(r.data, { workflow: wf });
}

// ---------------------------------------------------------------------------
// workflow.create
// ---------------------------------------------------------------------------

export const createWorkflowInputSchema = {
	type: "object",
	properties: {
		workflow: {
			description:
				"Workflow JSON to create (typically the output of workflow.generate). Either a parsed object or a JSON string.",
			oneOf: [{ type: "object" }, { type: "string" }],
		},
	},
	required: ["workflow"],
} as const;

const createWorkflowZod = z.object({
	workflow: z.union([z.record(z.unknown()), z.string()]),
});

export async function createWorkflow(rawArgs: unknown) {
	const cfg = getConfig();
	if ("error" in cfg) return errorResult(cfg.error);
	if (getAllowedWorkflowIds()) {
		return errorResult(
			"workflow.create is disabled when N8N_MCP_ALLOWED_WORKFLOW_IDS is set: a brand-new workflow's id cannot be in the allowlist by definition. Unset the env var or create the workflow in the n8n UI first, then add its id to the allowlist.",
		);
	}
	const args = createWorkflowZod.parse(rawArgs);
	const wf =
		typeof args.workflow === "string"
			? safeParse(args.workflow)
			: args.workflow;
	if (!wf || typeof wf !== "object" || Array.isArray(wf)) {
		return errorResult("Workflow payload is not a JSON object.");
	}
	const body = stripReadOnly(wf as Record<string, unknown>);
	const r = await call(cfg, "POST", "/workflows", body);
	if (!r.ok) return errorResult(r.error);
	const created = (r.data ?? {}) as Record<string, unknown>;
	const id = "id" in created ? String(created.id) : "";
	const name = (created.name as string) ?? "(unnamed)";
	const msg = id
		? `Created workflow "${name}" with id ${id}. Activate it with workflow.activate.`
		: `Workflow create returned no id. Raw response: ${JSON.stringify(r.data).slice(0, 200)}`;
	return textResult(msg, { id, name, workflow: created });
}

// ---------------------------------------------------------------------------
// workflow.activate
// ---------------------------------------------------------------------------

export const activateWorkflowInputSchema = {
	type: "object",
	properties: {
		id: { type: "string", description: "Workflow ID." },
		active: {
			type: "boolean",
			description:
				"Defaults to true (activate). Set false to deactivate.",
		},
	},
	required: ["id"],
} as const;

const activateWorkflowZod = z.object({
	id: z.string().min(1),
	active: z.boolean().optional(),
});

export async function activateWorkflow(rawArgs: unknown) {
	const cfg = getConfig();
	if ("error" in cfg) return errorResult(cfg.error);
	const args = activateWorkflowZod.parse(rawArgs);
	const denied = checkWorkflowAllowed(args.id);
	if (denied) return errorResult(denied);
	const action = args.active === false ? "deactivate" : "activate";
	const r = await call(
		cfg,
		"POST",
		`/workflows/${encodeURIComponent(args.id)}/${action}`,
	);
	if (!r.ok) return errorResult(r.error);
	return textResult(`Workflow ${args.id} ${action}d.`, {
		ok: true,
		id: args.id,
		action,
	});
}

// ---------------------------------------------------------------------------
// execution.list
// ---------------------------------------------------------------------------

export const listExecutionsInputSchema = {
	type: "object",
	properties: {
		workflowId: { type: "string", description: "Filter by workflow ID." },
		status: {
			type: "string",
			description: "Filter by status: success | error | waiting.",
			enum: ["success", "error", "waiting"],
		},
		limit: {
			type: "number",
			description: "Page size (n8n default: 100, max: 250).",
		},
		includeData: {
			type: "boolean",
			description:
				"Include full execution data (large). Default false — pair with execution.explain.",
		},
	},
} as const;

const listExecutionsZod = z.object({
	workflowId: z.string().optional(),
	status: z.enum(["success", "error", "waiting"]).optional(),
	limit: z.number().int().positive().max(250).optional(),
	includeData: z.boolean().optional(),
});

export async function listExecutions(rawArgs: unknown) {
	const cfg = getConfig();
	if ("error" in cfg) return errorResult(cfg.error);
	const args = listExecutionsZod.parse(rawArgs ?? {});
	if (args.workflowId) {
		const denied = checkWorkflowAllowed(args.workflowId);
		if (denied) return errorResult(denied);
	}
	const params = new URLSearchParams();
	if (args.workflowId) params.set("workflowId", args.workflowId);
	if (args.status) params.set("status", args.status);
	if (args.limit) params.set("limit", String(args.limit));
	if (args.includeData) params.set("includeData", "true");
	const qs = params.toString() ? `?${params}` : "";
	const r = await call(cfg, "GET", `/executions${qs}`);
	if (!r.ok) return errorResult(r.error);
	const data = r.data as { data?: unknown[] } | unknown[];
	let arr = Array.isArray(data) ? data : data?.data ?? [];
	const allowedIds = getAllowedWorkflowIds();
	if (allowedIds) {
		arr = (arr as Array<Record<string, unknown>>).filter((e) =>
			allowedIds.has(String(e.workflowId)),
		);
	}
	if (args.includeData) {
		return jsonResult(arr, {
			executions: arr as unknown[],
			count: (arr as unknown[]).length,
		});
	}
	const summary = (arr as Array<Record<string, unknown>>).map((e) => ({
		id: e.id,
		workflowId: e.workflowId,
		status: e.status,
		mode: e.mode,
		startedAt: e.startedAt,
		stoppedAt: e.stoppedAt,
		finished: e.finished,
	}));
	return jsonResult(summary, { executions: summary, count: summary.length });
}

// ---------------------------------------------------------------------------

function stripReadOnly(wf: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...wf };
	for (const k of [
		"id",
		"active",
		"createdAt",
		"updatedAt",
		"versionId",
		"triggerCount",
		"shared",
		"tags",
	]) {
		delete out[k];
	}
	return out;
}

function safeParse(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}
