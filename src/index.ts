#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { scaffoldNode } from "./tools/scaffold-node.js";
import { generateWorkflow } from "./tools/generate-workflow.js";
import { lintWorkflow } from "./tools/lint-workflow.js";
import { explainExecution } from "./tools/explain-execution.js";
import {
	activateWorkflow,
	createWorkflow,
	getWorkflow,
	listExecutions,
	listWorkflows,
} from "./tools/rest-api.js";
import {
	activateWorkflowOutputShape,
	createWorkflowOutputShape,
	explainExecutionOutputShape,
	generateWorkflowOutputShape,
	getWorkflowOutputShape,
	lintWorkflowOutputShape,
	listExecutionsOutputShape,
	listWorkflowsOutputShape,
	scaffoldNodeOutputShape,
} from "./output-schemas.js";

const VERSION = "0.4.0";

const server = new McpServer({
	name: "n8n-mcp",
	version: VERSION,
});

// ---------------------------------------------------------------------------
// Tool naming convention: dot-notation forms a navigable tree.
//   node.*       - n8n custom-node scaffolding
//   workflow.*   - workflow lifecycle (generate, lint, list, get, create, activate)
//   execution.*  - execution diagnosis and inspection
// Renamed in v0.4.0 from the previous flat n8n_* names.
// ---------------------------------------------------------------------------

// --- node.scaffold ---
server.registerTool(
	"node.scaffold",
	{
		title: "Scaffold an n8n custom node",
		description:
			"Scaffold a TypeScript skeleton for an n8n custom node from a plain-English description. Returns a single TypeScript file implementing INodeType with description, credentials reference, and an execute method stub. Pure code generation — no network, no filesystem writes.",
		inputSchema: {
			description: z
				.string()
				.min(1)
				.describe(
					"Plain-English description of what the node should do (1+ chars).",
				),
			nodeName: z
				.string()
				.regex(/^[A-Z][A-Za-z0-9]*$/, "nodeName must be PascalCase")
				.optional()
				.describe(
					"Optional PascalCase class name, e.g. 'DiscordRateLimited'. Derived from the description if omitted.",
				),
		},
		outputSchema: scaffoldNodeOutputShape,
		annotations: {
			title: "Scaffold an n8n custom node",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false,
		},
	},
	async (input) => scaffoldNode(input),
);

// --- workflow.generate ---
server.registerTool(
	"workflow.generate",
	{
		title: "Generate an n8n workflow from a description",
		description:
			"Generate a valid n8n workflow JSON from a plain-English description. Handles webhook/schedule/RSS triggers, common action nodes (Slack, Google Sheets, Discord, Gmail, Notion, HTTP), and AI Agent setups (LangChain root agent + chat model + memory + optional HTTP tool, wired with ai_languageModel / ai_memory / ai_tool connections). Returns workflow JSON with unique node IDs, connections, positions, and typeVersion on every node. Output is non-deterministic (random node IDs and webhook paths).",
		inputSchema: {
			description: z
				.string()
				.min(1)
				.describe(
					"Plain-English workflow description, e.g. 'Stripe webhook -> Slack message + Google Sheets row'.",
				),
			name: z
				.string()
				.optional()
				.describe(
					"Optional workflow name. Derived from the first sentence of the description if omitted.",
				),
		},
		outputSchema: generateWorkflowOutputShape,
		annotations: {
			title: "Generate an n8n workflow from a description",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false,
		},
	},
	async (input) => generateWorkflow(input),
);

// --- workflow.lint ---
server.registerTool(
	"workflow.lint",
	{
		title: "Lint an n8n workflow JSON",
		description:
			"Lint an n8n workflow JSON. Returns concrete errors and warnings: missing credentials, deprecated node types (Function -> Code, spreadsheetFile -> convertToFile/extractFromFile), broken connections, missing or non-numeric typeVersion, duplicate node names or IDs, AI Agent missing ai_languageModel sub-node, Webhook missing webhookId, IF node still on v1 condition schema. Deterministic, rule-based.",
		inputSchema: {
			workflow: z
				.union([z.record(z.unknown()), z.string()])
				.describe(
					"n8n workflow as either a parsed object or a JSON string (will be parsed).",
				),
		},
		outputSchema: lintWorkflowOutputShape,
		annotations: {
			title: "Lint an n8n workflow JSON",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
	},
	async (input) => lintWorkflow(input),
);

// --- execution.explain ---
server.registerTool(
	"execution.explain",
	{
		title: "Explain a failed n8n execution",
		description:
			"Diagnose a failed or surprising n8n execution. Paste the execution JSON (from the n8n UI 'Show details' or `GET /executions/:id?includeData=true`); returns a per-node summary highlighting nodes that returned 0 items, unresolved `={{ ... }}` expressions, errors with hints, and LLM token usage. Hits the most common debugging pain point: items 'silently disappearing' between nodes. Deterministic, rule-based.",
		inputSchema: {
			execution: z
				.union([z.record(z.unknown()), z.string()])
				.describe(
					"n8n execution payload (REST `?includeData=true` shape or raw UI export). Object or JSON string.",
				),
		},
		outputSchema: explainExecutionOutputShape,
		annotations: {
			title: "Explain a failed n8n execution",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
	},
	async (input) => explainExecution(input),
);

// --- workflow.list ---
server.registerTool(
	"workflow.list",
	{
		title: "List workflows on a live n8n instance",
		description:
			"List workflows from a live n8n instance (requires N8N_API_URL + N8N_API_KEY env vars). Returns id, name, active, nodeCount, updatedAt, tags. Filter by active, tags, name. Use this when the user asks 'what workflows do I have?' or before workflow.get.",
		inputSchema: {
			active: z
				.boolean()
				.optional()
				.describe("Filter by active status. Omit to return both."),
			tags: z
				.string()
				.optional()
				.describe("Comma-separated tag names to filter by."),
			name: z.string().optional().describe("Filter by exact workflow name."),
			limit: z
				.number()
				.int()
				.positive()
				.max(250)
				.optional()
				.describe("Page size (n8n default: 100, max: 250)."),
		},
		outputSchema: listWorkflowsOutputShape,
		annotations: {
			title: "List workflows on a live n8n instance",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		},
	},
	async (input) => listWorkflows(input),
);

// --- workflow.get ---
server.registerTool(
	"workflow.get",
	{
		title: "Fetch a single workflow by ID",
		description:
			"Fetch a single workflow JSON by id from a live n8n instance (requires N8N_API_URL + N8N_API_KEY). Returns the full nodes/connections payload — pair with workflow.lint to audit a deployed workflow.",
		inputSchema: {
			id: z.string().min(1).describe("Workflow ID."),
		},
		outputSchema: getWorkflowOutputShape,
		annotations: {
			title: "Fetch a single workflow by ID",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		},
	},
	async (input) => getWorkflow(input),
);

// --- workflow.create ---
server.registerTool(
	"workflow.create",
	{
		title: "Create a workflow on a live n8n instance",
		description:
			"Create a workflow on a live n8n instance (requires N8N_API_URL + N8N_API_KEY). Strips read-only fields (id, active, createdAt, ...) before posting. Workflows are created inactive — call workflow.activate afterward. Pairs with workflow.generate for end-to-end 'describe -> deploy'.",
		inputSchema: {
			workflow: z
				.union([z.record(z.unknown()), z.string()])
				.describe(
					"Workflow JSON to create (typically the output of workflow.generate). Either a parsed object or a JSON string.",
				),
		},
		outputSchema: createWorkflowOutputShape,
		annotations: {
			title: "Create a workflow on a live n8n instance",
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
	},
	async (input) => createWorkflow(input),
);

// --- workflow.activate ---
server.registerTool(
	"workflow.activate",
	{
		title: "Activate or deactivate a workflow",
		description:
			"Activate or deactivate a workflow on a live n8n instance (requires N8N_API_URL + N8N_API_KEY). Pass `active: false` to deactivate. Idempotent — re-activating an already-active workflow is a no-op on n8n's side.",
		inputSchema: {
			id: z.string().min(1).describe("Workflow ID."),
			active: z
				.boolean()
				.optional()
				.describe("Defaults to true (activate). Set false to deactivate."),
		},
		outputSchema: activateWorkflowOutputShape,
		annotations: {
			title: "Activate or deactivate a workflow",
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		},
	},
	async (input) => activateWorkflow(input),
);

// --- execution.list ---
server.registerTool(
	"execution.list",
	{
		title: "List recent n8n executions",
		description:
			"List recent executions from a live n8n instance (requires N8N_API_URL + N8N_API_KEY). Filter by workflowId, status (success|error|waiting), limit. Pass `includeData: true` to get the full execution body (large) — pair with execution.explain to diagnose a specific failure.",
		inputSchema: {
			workflowId: z.string().optional().describe("Filter by workflow ID."),
			status: z
				.enum(["success", "error", "waiting"])
				.optional()
				.describe("Filter by status: success | error | waiting."),
			limit: z
				.number()
				.int()
				.positive()
				.max(250)
				.optional()
				.describe("Page size (n8n default: 100, max: 250)."),
			includeData: z
				.boolean()
				.optional()
				.describe(
					"Include full execution data (large). Default false — pair with execution.explain.",
				),
		},
		outputSchema: listExecutionsOutputShape,
		annotations: {
			title: "List recent n8n executions",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		},
	},
	async (input) => listExecutions(input),
);

const TOOL_NAMES = [
	"node.scaffold",
	"workflow.generate",
	"workflow.lint",
	"execution.explain",
	"workflow.list",
	"workflow.get",
	"workflow.create",
	"workflow.activate",
	"execution.list",
];

async function main() {
	if (process.argv.includes("--smoke")) {
		const summary = {
			server: "n8n-mcp",
			version: VERSION,
			tools: TOOL_NAMES,
		};
		process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
		return;
	}
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	process.stderr.write(`n8n-mcp fatal: ${(err as Error).message}\n`);
	process.exit(1);
});
