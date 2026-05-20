import { randomUUID } from "node:crypto";
import { z } from "zod";

export const generateWorkflowInputSchema = {
	type: "object",
	properties: {
		description: {
			type: "string",
			description:
				"Plain-English workflow description, e.g. 'Stripe webhook -> Slack message + Google Sheets row'.",
		},
		name: {
			type: "string",
			description:
				"Optional workflow name. Derived from the first sentence of the description if omitted.",
		},
	},
	required: ["description"],
} as const;

const inputZod = z.object({
	description: z.string().min(1),
	name: z.string().optional(),
});

interface NodeSpec {
	id: string;
	name: string;
	type: string;
	typeVersion: number;
	position: [number, number];
	parameters: Record<string, unknown>;
}

interface MainConnection {
	node: string;
	type: "main";
	index: number;
}

interface WireConnection {
	node: string;
	type: string;
	index: number;
}

const AI_AGENT_PATTERN =
	/\b(ai\s+agent|llm\s+agent|chatbot|chat\s*bot|gpt|claude|langchain|conversational\s+agent)\b/i;

const TRIGGER_PATTERNS: { match: RegExp; build: () => NodeSpec }[] = [
	{
		match: /\bwebhook\b/i,
		build: () => ({
			id: randomUUID(),
			name: "Webhook",
			type: "n8n-nodes-base.webhook",
			typeVersion: 2,
			position: [240, 300],
			parameters: {
				httpMethod: "POST",
				path: "n8n-mcp-" + Math.random().toString(36).slice(2, 8),
				responseMode: "onReceived",
				options: {},
			},
		}),
	},
	{
		match: /\b(schedule|cron|hourly|daily|every\s+\w+)\b/i,
		build: () => ({
			id: randomUUID(),
			name: "Schedule Trigger",
			type: "n8n-nodes-base.scheduleTrigger",
			typeVersion: 1.2,
			position: [240, 300],
			parameters: {
				rule: { interval: [{ field: "hours", hoursInterval: 1 }] },
			},
		}),
	},
	{
		match: /\b(rss|feed)\b/i,
		build: () => ({
			id: randomUUID(),
			name: "RSS Feed Trigger",
			type: "n8n-nodes-base.rssFeedReadTrigger",
			typeVersion: 1,
			position: [240, 300],
			parameters: {
				feedUrl: "https://example.com/feed.xml",
				pollTimes: { item: [{ mode: "everyHour" }] },
			},
		}),
	},
];

const ACTION_PATTERNS: {
	match: RegExp;
	build: (slot: number) => NodeSpec;
}[] = [
	{
		match: /\bslack\b/i,
		build: (slot) => ({
			id: randomUUID(),
			name: "Slack",
			type: "n8n-nodes-base.slack",
			typeVersion: 2.2,
			position: [560, 200 + slot * 180],
			parameters: {
				resource: "message",
				operation: "post",
				select: "channel",
				channelId: { __rl: true, mode: "name", value: "general" },
				text: "={{ JSON.stringify($json) }}",
				otherOptions: {},
			},
		}),
	},
	{
		match: /\b(google\s*sheets?|spreadsheet)\b/i,
		build: (slot) => ({
			id: randomUUID(),
			name: "Google Sheets",
			type: "n8n-nodes-base.googleSheets",
			typeVersion: 4,
			position: [560, 200 + slot * 180],
			parameters: {
				resource: "sheet",
				operation: "appendOrUpdate",
				documentId: { __rl: true, mode: "list", value: "" },
				sheetName: { __rl: true, mode: "list", value: "" },
				columns: { mappingMode: "autoMapInputData", value: {} },
				options: {},
			},
		}),
	},
	{
		match: /\bdiscord\b/i,
		build: (slot) => ({
			id: randomUUID(),
			name: "Discord",
			type: "n8n-nodes-base.discord",
			typeVersion: 2,
			position: [560, 200 + slot * 180],
			parameters: {
				resource: "message",
				operation: "send",
				content: "={{ JSON.stringify($json) }}",
			},
		}),
	},
	{
		match: /\b(gmail|email|mail)\b/i,
		build: (slot) => ({
			id: randomUUID(),
			name: "Send Email",
			type: "n8n-nodes-base.gmail",
			typeVersion: 2.1,
			position: [560, 200 + slot * 180],
			parameters: {
				resource: "message",
				operation: "send",
				toList: ["recipient@example.com"],
				subject: "n8n notification",
				message: "={{ JSON.stringify($json) }}",
				options: {},
			},
		}),
	},
	{
		match: /\b(notion)\b/i,
		build: (slot) => ({
			id: randomUUID(),
			name: "Notion",
			type: "n8n-nodes-base.notion",
			typeVersion: 2.2,
			position: [560, 200 + slot * 180],
			parameters: {
				resource: "databasePage",
				operation: "create",
				databaseId: { __rl: true, mode: "list", value: "" },
				propertiesUi: { propertyValues: [] },
			},
		}),
	},
	{
		match: /\b(http\s*request|api\s*call|fetch|post\s+to)\b/i,
		build: (slot) => ({
			id: randomUUID(),
			name: "HTTP Request",
			type: "n8n-nodes-base.httpRequest",
			typeVersion: 4.2,
			position: [560, 200 + slot * 180],
			parameters: {
				method: "POST",
				url: "https://example.com/api",
				sendBody: true,
				bodyParameters: { parameters: [] },
				options: {},
			},
		}),
	},
];

function deriveName(description: string): string {
	const first = description.split(/[.\n]/)[0]?.trim() ?? "";
	return first.length > 0 ? first.slice(0, 60) : "Generated Workflow";
}

export async function generateWorkflow(rawArgs: unknown) {
	const args = inputZod.parse(rawArgs);

	if (AI_AGENT_PATTERN.test(args.description)) {
		return buildAiAgentWorkflow(args);
	}

	let trigger: NodeSpec | null = null;
	for (const p of TRIGGER_PATTERNS) {
		if (p.match.test(args.description)) {
			trigger = p.build();
			break;
		}
	}
	if (!trigger) {
		trigger = {
			id: randomUUID(),
			name: "Manual Trigger",
			type: "n8n-nodes-base.manualTrigger",
			typeVersion: 1,
			position: [240, 300],
			parameters: {},
		};
	}

	const actions: NodeSpec[] = [];
	let slot = 0;
	for (const p of ACTION_PATTERNS) {
		if (p.match.test(args.description)) {
			actions.push(p.build(slot++));
		}
	}
	if (actions.length === 0) {
		actions.push({
			id: randomUUID(),
			name: "HTTP Request",
			type: "n8n-nodes-base.httpRequest",
			typeVersion: 4.2,
			position: [560, 300],
			parameters: {
				method: "POST",
				url: "https://example.com/api",
				sendBody: true,
				bodyParameters: { parameters: [] },
				options: {},
			},
		});
	}

	const nodes = [trigger, ...actions];

	const connections: Record<string, { main: MainConnection[][] }> = {
		[trigger.name]: {
			main: [
				actions.map((a) => ({ node: a.name, type: "main" as const, index: 0 })),
			],
		},
	};

	const workflow = {
		name: args.name ?? deriveName(args.description),
		nodes,
		connections,
		active: false,
		settings: { executionOrder: "v1" },
		pinData: {},
	};

	return {
		content: [
			{ type: "text" as const, text: JSON.stringify(workflow, null, 2) },
		],
		structuredContent: { workflow },
	};
}

function buildAiAgentWorkflow(args: { description: string; name?: string }) {
	const trigger: NodeSpec = {
		id: randomUUID(),
		name: "When chat message received",
		type: "@n8n/n8n-nodes-langchain.chatTrigger",
		typeVersion: 1.1,
		position: [240, 300],
		parameters: { options: {} },
	};

	const agent: NodeSpec = {
		id: randomUUID(),
		name: "AI Agent",
		type: "@n8n/n8n-nodes-langchain.agent",
		typeVersion: 1.7,
		position: [480, 300],
		parameters: { options: {} },
	};

	const chatModel: NodeSpec = {
		id: randomUUID(),
		name: "OpenAI Chat Model",
		type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
		typeVersion: 1.2,
		position: [400, 480],
		parameters: {
			model: { __rl: true, mode: "list", value: "gpt-4o-mini" },
			options: {},
		},
	};

	const memory: NodeSpec = {
		id: randomUUID(),
		name: "Window Buffer Memory",
		type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
		typeVersion: 1.3,
		position: [560, 480],
		parameters: {},
	};

	const nodes: NodeSpec[] = [trigger, agent, chatModel, memory];

	const connections: Record<string, Record<string, WireConnection[][]>> = {
		[trigger.name]: {
			main: [[{ node: agent.name, type: "main", index: 0 }]],
		},
		[chatModel.name]: {
			ai_languageModel: [
				[{ node: agent.name, type: "ai_languageModel", index: 0 }],
			],
		},
		[memory.name]: {
			ai_memory: [[{ node: agent.name, type: "ai_memory", index: 0 }]],
		},
	};

	if (/\b(http|api|tool|fetch)\b/i.test(args.description)) {
		const httpTool: NodeSpec = {
			id: randomUUID(),
			name: "HTTP Request Tool",
			type: "@n8n/n8n-nodes-langchain.toolHttpRequest",
			typeVersion: 1.1,
			position: [720, 480],
			parameters: {
				toolDescription:
					"Call an external HTTP API. Replace the URL and parameters before running.",
				url: "https://example.com/api",
				method: "GET",
				sendBody: false,
			},
		};
		nodes.push(httpTool);
		connections[httpTool.name] = {
			ai_tool: [[{ node: agent.name, type: "ai_tool", index: 0 }]],
		};
	}

	const workflow = {
		name: args.name ?? deriveName(args.description),
		nodes,
		connections,
		active: false,
		settings: { executionOrder: "v1" },
		pinData: {},
	};

	return {
		content: [
			{ type: "text" as const, text: JSON.stringify(workflow, null, 2) },
		],
		structuredContent: { workflow },
	};
}
