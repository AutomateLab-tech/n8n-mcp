/**
 * Catalog of n8n node behaviors used by the lint and generate tools.
 *
 * The lists here are intentionally narrow: they cover the most common nodes
 * a user is likely to ship in a workflow. Unknown node types are treated as
 * valid by the linter (no false positives).
 */

export const DEPRECATED_NODE_TYPES: Record<string, string> = {
	"n8n-nodes-base.function": "n8n-nodes-base.code",
	"n8n-nodes-base.functionItem": "n8n-nodes-base.code",
	"n8n-nodes-base.start": "n8n-nodes-base.manualTrigger",
	"n8n-nodes-base.spreadsheetFile":
		"n8n-nodes-base.convertToFile or n8n-nodes-base.extractFromFile",
};

/**
 * AI agent root types. Both prefixes appear in the wild: the older
 * `n8n-nodes-langchain.*` and the canonical `@n8n/n8n-nodes-langchain.*`.
 */
export const AI_AGENT_TYPES = new Set<string>([
	"n8n-nodes-langchain.agent",
	"@n8n/n8n-nodes-langchain.agent",
]);

export const WEBHOOK_TYPES = new Set<string>([
	"n8n-nodes-base.webhook",
]);

export const IF_NODE_TYPES = new Set<string>([
	"n8n-nodes-base.if",
]);

export const CREDENTIAL_REQUIRED_TYPES = new Set<string>([
	"n8n-nodes-base.airtable",
	"n8n-nodes-base.discord",
	"n8n-nodes-base.gmail",
	"n8n-nodes-base.googleSheets",
	"n8n-nodes-base.notion",
	"n8n-nodes-base.openAi",
	"n8n-nodes-base.postgres",
	"n8n-nodes-base.slack",
	"n8n-nodes-base.stripe",
]);

export const KNOWN_TRIGGER_TYPES = new Set<string>([
	"n8n-nodes-base.manualTrigger",
	"n8n-nodes-base.webhook",
	"n8n-nodes-base.scheduleTrigger",
	"n8n-nodes-base.cron",
	"n8n-nodes-base.rssFeedReadTrigger",
	"n8n-nodes-base.emailReadImap",
]);

/**
 * Nodes that hit rate-limited third-party APIs. If the workflow loops
 * through items without batching, it will eat 429s.
 */
export const RATE_SENSITIVE_TYPES = new Set<string>([
	"n8n-nodes-base.openAi",
	"n8n-nodes-base.anthropic",
	"n8n-nodes-base.slack",
	"n8n-nodes-base.discord",
	"n8n-nodes-base.gmail",
	"n8n-nodes-base.googleSheets",
	"n8n-nodes-base.notion",
	"n8n-nodes-base.airtable",
	"n8n-nodes-base.stripe",
	"@n8n/n8n-nodes-langchain.lmChatOpenAi",
	"@n8n/n8n-nodes-langchain.lmChatAnthropic",
]);

export const HTTP_REQUEST_TYPES = new Set<string>([
	"n8n-nodes-base.httpRequest",
]);

export const SCHEDULE_TRIGGER_TYPES = new Set<string>([
	"n8n-nodes-base.scheduleTrigger",
	"n8n-nodes-base.cron",
]);

export const CODE_NODE_TYPES = new Set<string>([
	"n8n-nodes-base.code",
]);

export const SET_NODE_TYPES = new Set<string>([
	"n8n-nodes-base.set",
]);

export const MANUAL_TRIGGER_TYPES = new Set<string>([
	"n8n-nodes-base.manualTrigger",
]);

/**
 * Patterns the Code node sandbox forbids. Lifted from the n8n docs:
 * `require`, `process`, `fetch`, `eval`, `__dirname`, `__filename`.
 */
export const CODE_SANDBOX_FORBIDDEN = [
	/\brequire\s*\(/,
	/\bprocess\./,
	/\bfetch\s*\(/,
	/\beval\s*\(/,
	/\b__dirname\b/,
	/\b__filename\b/,
];
