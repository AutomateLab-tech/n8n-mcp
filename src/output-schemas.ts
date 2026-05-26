import { z } from "zod";

/**
 * Zod *raw shapes* (not full ZodObject) for use as `outputSchema` in
 * server.registerTool(...). The MCP SDK converts these to JSON Schema and
 * validates `structuredContent` against them at call time.
 */

export const scaffoldNodeOutputShape = {
	node_name: z.string().describe("PascalCase class name of the generated node."),
	display_name: z
		.string()
		.describe("Human-readable display name shown in the n8n UI."),
	source: z
		.string()
		.describe("The full TypeScript source of the scaffolded node."),
	language: z
		.literal("typescript")
		.describe("Always 'typescript' — n8n custom nodes are TS-only."),
} as const;

const workflowShape = z
	.record(z.unknown())
	.describe("Full n8n workflow JSON (name, nodes, connections, settings, ...).");

export const generateWorkflowOutputShape = {
	workflow: workflowShape,
} as const;

const lintIssueSchema = z.object({
	severity: z.enum(["error", "warning"]),
	node: z.string().optional(),
	message: z.string(),
});

export const lintWorkflowOutputShape = {
	issues: z
		.array(lintIssueSchema)
		.describe("All lint findings, ordered by node."),
	error_count: z.number().int().describe("Number of error-severity issues."),
	warning_count: z
		.number()
		.int()
		.describe("Number of warning-severity issues."),
} as const;

const findingSchema = z.object({
	severity: z.enum(["error", "warning", "info"]),
	node: z.string().optional(),
	message: z.string(),
	hint: z.string().optional(),
});

export const explainExecutionOutputShape = {
	findings: z
		.array(findingSchema)
		.describe("Per-node findings extracted from the execution payload."),
	error_count: z.number().int().describe("Number of error-severity findings."),
	warning_count: z
		.number()
		.int()
		.describe("Number of warning-severity findings."),
} as const;

const workflowSummarySchema = z.object({
	id: z.unknown(),
	name: z.unknown(),
	active: z.unknown(),
	nodeCount: z.number().optional(),
	updatedAt: z.unknown(),
	tags: z.array(z.string()).optional(),
});

export const listWorkflowsOutputShape = {
	workflows: z
		.array(workflowSummarySchema)
		.describe("Summary of each workflow (id, name, active, nodeCount, ...)."),
	count: z.number().int().describe("Number of workflows returned."),
} as const;

export const getWorkflowOutputShape = {
	workflow: workflowShape,
} as const;

export const createWorkflowOutputShape = {
	id: z.string().describe("The ID assigned by n8n to the new workflow."),
	name: z.string().describe("The name of the newly created workflow."),
	workflow: workflowShape,
} as const;

export const activateWorkflowOutputShape = {
	ok: z.literal(true),
	id: z.string().describe("The workflow ID that was (de)activated."),
	action: z
		.enum(["activate", "deactivate"])
		.describe("Which action was performed."),
} as const;

const executionSummarySchema = z.object({
	id: z.unknown(),
	workflowId: z.unknown(),
	status: z.unknown(),
	mode: z.unknown(),
	startedAt: z.unknown(),
	stoppedAt: z.unknown(),
	finished: z.unknown(),
});

export const listExecutionsOutputShape = {
	executions: z
		.array(z.union([executionSummarySchema, z.record(z.unknown())]))
		.describe(
			"Either trimmed summaries (default) or full execution bodies (includeData=true).",
		),
	count: z.number().int().describe("Number of executions returned."),
} as const;

export const replayExecutionOutputShape = {
	workflow: workflowShape,
	item_count: z
		.number()
		.int()
		.describe("Number of input items the replay seed will feed the target."),
	target_node: z.string().describe("Name of the node being replayed."),
} as const;

const diffChangeSchema = z.object({
	kind: z.enum([
		"node_added",
		"node_removed",
		"node_modified",
		"connection_added",
		"connection_removed",
		"setting_changed",
		"active_changed",
		"name_changed",
	]),
	node: z.string().optional(),
	detail: z.string(),
});

export const diffWorkflowOutputShape = {
	changes: z
		.array(diffChangeSchema)
		.describe("Ordered list of semantic differences."),
	summary: z.string().describe("One-line summary of change counts by kind."),
	change_count: z.number().int(),
} as const;

const timelineRowSchema = z.object({
	node: z.string(),
	run_index: z.number().int(),
	start_ms: z.number(),
	duration_ms: z.number(),
	items_in: z.number().int().nullable(),
	items_out: z.number().int(),
	had_error: z.boolean(),
	error_message: z.string().nullable(),
});

export const timelineExecutionOutputShape = {
	rows: z
		.array(timelineRowSchema)
		.describe("Per-node-run timing and item counts, sorted by start_ms."),
	total_ms: z
		.number()
		.describe("Wall-clock duration of the whole execution in milliseconds."),
	row_count: z.number().int(),
} as const;
