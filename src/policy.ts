/**
 * Runtime policy gating. Lets operators run this server in a constrained
 * mode without forking the codebase.
 *
 * Environment variables:
 *   N8N_MCP_READ_ONLY=1         Disables all write tools (create, activate,
 *                               scaffold). Diagnostic tools still work.
 *   N8N_MCP_DISABLED_TOOLS=...  Comma-separated list of tool names to skip
 *                               registering entirely, e.g.
 *                               "workflow.create,workflow.activate".
 *   N8N_MCP_ALLOWED_WORKFLOW_IDS=...  Comma-separated workflow IDs. When
 *                               set, REST tools refuse to touch any
 *                               workflow outside this list.
 *   N8N_MCP_ALLOWED_TAGS=...    Comma-separated tag names. workflow.list
 *                               filters its results to workflows carrying
 *                               at least one of these tags.
 */

const WRITE_TOOLS = new Set<string>([
	"workflow.create",
	"workflow.activate",
	"node.scaffold",
]);

function parseList(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

function isTruthy(raw: string | undefined): boolean {
	if (!raw) return false;
	const v = raw.trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function isReadOnly(): boolean {
	return isTruthy(process.env.N8N_MCP_READ_ONLY);
}

export function getDisabledTools(): Set<string> {
	return new Set(parseList(process.env.N8N_MCP_DISABLED_TOOLS));
}

export function isToolEnabled(name: string): boolean {
	if (getDisabledTools().has(name)) return false;
	if (isReadOnly() && WRITE_TOOLS.has(name)) return false;
	return true;
}

export function getAllowedWorkflowIds(): Set<string> | null {
	const list = parseList(process.env.N8N_MCP_ALLOWED_WORKFLOW_IDS);
	return list.length > 0 ? new Set(list) : null;
}

export function getAllowedTags(): Set<string> | null {
	const list = parseList(process.env.N8N_MCP_ALLOWED_TAGS);
	return list.length > 0 ? new Set(list) : null;
}

export function checkWorkflowAllowed(id: string): string | null {
	const allowed = getAllowedWorkflowIds();
	if (!allowed) return null;
	if (allowed.has(id)) return null;
	return `Workflow ${id} is not in N8N_MCP_ALLOWED_WORKFLOW_IDS. This server is gated to a fixed allowlist.`;
}

export function policySummary(): {
	read_only: boolean;
	disabled_tools: string[];
	allowed_workflow_ids: string[] | null;
	allowed_tags: string[] | null;
} {
	const allowedIds = getAllowedWorkflowIds();
	const allowedTags = getAllowedTags();
	return {
		read_only: isReadOnly(),
		disabled_tools: [...getDisabledTools()],
		allowed_workflow_ids: allowedIds ? [...allowedIds] : null,
		allowed_tags: allowedTags ? [...allowedTags] : null,
	};
}
