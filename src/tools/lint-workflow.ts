import { z } from "zod";
import {
	AI_AGENT_TYPES,
	CODE_NODE_TYPES,
	CODE_SANDBOX_FORBIDDEN,
	CREDENTIAL_REQUIRED_TYPES,
	DEPRECATED_NODE_TYPES,
	HTTP_REQUEST_TYPES,
	IF_NODE_TYPES,
	MANUAL_TRIGGER_TYPES,
	RATE_SENSITIVE_TYPES,
	SCHEDULE_TRIGGER_TYPES,
	SET_NODE_TYPES,
	WEBHOOK_TYPES,
} from "../schemas/node-catalog.js";

export const lintWorkflowInputSchema = {
	type: "object",
	properties: {
		workflow: {
			description:
				"n8n workflow as either a parsed object or a JSON string.",
			oneOf: [{ type: "object" }, { type: "string" }],
		},
	},
	required: ["workflow"],
} as const;

const inputZod = z.object({
	workflow: z.union([z.record(z.unknown()), z.string()]),
});

interface Issue {
	severity: "error" | "warning";
	node?: string;
	message: string;
}

export async function lintWorkflow(rawArgs: unknown) {
	const args = inputZod.parse(rawArgs);
	const workflow =
		typeof args.workflow === "string"
			? safeParse(args.workflow)
			: args.workflow;
	const issues: Issue[] = [];

	if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
		issues.push({
			severity: "error",
			message: "Workflow is not a JSON object.",
		});
		return formatResult(issues);
	}

	const wf = workflow as Record<string, unknown>;
	const nodes = wf.nodes;
	if (!Array.isArray(nodes)) {
		issues.push({
			severity: "error",
			message: "Workflow has no `nodes` array.",
		});
		return formatResult(issues);
	}

	const connections =
		wf.connections && typeof wf.connections === "object"
			? (wf.connections as Record<string, unknown>)
			: {};

	const isActive = wf.active === true;
	const nodeNames = new Set<string>();
	const seenIds = new Set<string>();
	const incomingByType: Record<string, Map<string, number>> = {};
	const outgoingByType: Record<string, Map<string, number>> = {};

	for (const [src, conf] of Object.entries(connections)) {
		if (!conf || typeof conf !== "object") continue;
		for (const [connType, branches] of Object.entries(
			conf as Record<string, unknown>,
		)) {
			if (!Array.isArray(branches)) continue;
			for (const branch of branches) {
				if (!Array.isArray(branch)) continue;
				for (const c of branch) {
					if (!c || typeof c !== "object") continue;
					const target = (c as Record<string, unknown>).node;
					if (typeof target !== "string") continue;
					const map = (incomingByType[connType] ??= new Map());
					map.set(target, (map.get(target) ?? 0) + 1);
					const outMap = (outgoingByType[connType] ??= new Map());
					outMap.set(src, (outMap.get(src) ?? 0) + 1);
				}
			}
		}
	}

	for (const raw of nodes) {
		if (!raw || typeof raw !== "object") {
			issues.push({ severity: "error", message: "Node is not an object." });
			continue;
		}
		const n = raw as Record<string, unknown>;
		const nodeName = typeof n.name === "string" ? n.name : undefined;

		if (!nodeName) {
			issues.push({ severity: "error", message: "Node missing string `name`." });
		} else {
			if (nodeNames.has(nodeName)) {
				issues.push({
					severity: "error",
					node: nodeName,
					message: "Duplicate node name.",
				});
			}
			nodeNames.add(nodeName);
		}

		if (typeof n.id !== "string") {
			issues.push({
				severity: "error",
				node: nodeName,
				message: "Node missing string `id`.",
			});
		} else {
			if (seenIds.has(n.id)) {
				issues.push({
					severity: "error",
					node: nodeName,
					message: `Duplicate node id ${n.id}.`,
				});
			}
			seenIds.add(n.id);
		}

		const nodeType = typeof n.type === "string" ? n.type : undefined;
		if (!nodeType) {
			issues.push({
				severity: "error",
				node: nodeName,
				message: "Node missing string `type`.",
			});
		} else if (DEPRECATED_NODE_TYPES[nodeType]) {
			issues.push({
				severity: "warning",
				node: nodeName,
				message: `Node type "${nodeType}" is deprecated. Use "${DEPRECATED_NODE_TYPES[nodeType]}".`,
			});
		}

		if (n.typeVersion === undefined || n.typeVersion === null) {
			issues.push({
				severity: "error",
				node: nodeName,
				message: "Missing `typeVersion`.",
			});
		} else if (typeof n.typeVersion !== "number") {
			issues.push({
				severity: "error",
				node: nodeName,
				message: "`typeVersion` must be a number.",
			});
		}

		if (
			!Array.isArray(n.position) ||
			n.position.length !== 2 ||
			n.position.some((v) => typeof v !== "number")
		) {
			issues.push({
				severity: "warning",
				node: nodeName,
				message: "`position` should be a [x, y] array of numbers.",
			});
		}

		if (nodeType && CREDENTIAL_REQUIRED_TYPES.has(nodeType) && !n.credentials) {
			issues.push({
				severity: "warning",
				node: nodeName,
				message: `Node type "${nodeType}" usually needs a credential. None set.`,
			});
		}

		if (nodeType && AI_AGENT_TYPES.has(nodeType) && nodeName) {
			const lm = incomingByType["ai_languageModel"]?.get(nodeName) ?? 0;
			if (lm === 0) {
				issues.push({
					severity: "error",
					node: nodeName,
					message:
						"AI Agent has no `ai_languageModel` sub-node connected. Attach a chat model (e.g. lmChatOpenAi).",
				});
			}
		}

		if (nodeType && WEBHOOK_TYPES.has(nodeType) && !n.webhookId) {
			issues.push({
				severity: "warning",
				node: nodeName,
				message:
					"Webhook node has no `webhookId`. n8n auto-generates one on import, so the production URL will change. Set `webhookId` to keep a stable URL.",
			});
		}

		const params =
			n.parameters && typeof n.parameters === "object"
				? (n.parameters as Record<string, unknown>)
				: {};

		// Rule: manualTrigger in an active workflow never fires.
		if (
			isActive &&
			nodeType &&
			MANUAL_TRIGGER_TYPES.has(nodeType) &&
			nodeName
		) {
			const wired = (outgoingByType.main?.get(nodeName) ?? 0) > 0;
			if (wired) {
				issues.push({
					severity: "warning",
					node: nodeName,
					message:
						"Manual Trigger is wired into an active workflow. Active workflows are triggered by webhooks/schedules — manualTrigger only fires from the n8n UI's 'Execute workflow' button.",
				});
			}
		}

		// Rule: disabled node with downstream connections.
		if (n.disabled === true && nodeName) {
			const hasDownstream = (outgoingByType.main?.get(nodeName) ?? 0) > 0;
			if (hasDownstream) {
				issues.push({
					severity: "warning",
					node: nodeName,
					message:
						"Node is disabled but has downstream connections. n8n will pass items through unchanged — this is usually unintended. Delete the node or rewire around it.",
				});
			}
		}

		// Rule: Schedule trigger using `hour` triggerAtHour without timezone.
		if (nodeType && SCHEDULE_TRIGGER_TYPES.has(nodeType)) {
			const rule = params.rule as Record<string, unknown> | undefined;
			const interval = Array.isArray(rule?.interval) ? rule!.interval : [];
			const hasHourTrigger = interval.some(
				(i) =>
					i &&
					typeof i === "object" &&
					"triggerAtHour" in (i as Record<string, unknown>),
			);
			const wfSettings = (wf.settings ?? {}) as Record<string, unknown>;
			const timezone = wfSettings.timezone;
			if (hasHourTrigger && (!timezone || typeof timezone !== "string")) {
				issues.push({
					severity: "warning",
					node: nodeName,
					message:
						"Schedule trigger uses `triggerAtHour` but workflow has no `settings.timezone` set. Will fall back to the n8n instance's timezone, drift during DST, and surprise you twice a year. Set `settings.timezone` (e.g. 'UTC' or 'America/New_York').",
				});
			}
		}

		// Rule: Code node references forbidden sandbox APIs.
		if (nodeType && CODE_NODE_TYPES.has(nodeType)) {
			const code =
				typeof params.jsCode === "string"
					? params.jsCode
					: typeof params.pythonCode === "string"
						? params.pythonCode
						: undefined;
			if (typeof code === "string") {
				for (const pat of CODE_SANDBOX_FORBIDDEN) {
					if (pat.test(code)) {
						issues.push({
							severity: "error",
							node: nodeName,
							message: `Code node references "${pat.source.replace(/\\b/g, "").replace(/\\s\*/g, "").replace(/\\\./g, ".")}" which the n8n sandbox forbids. Use the HTTP Request node instead of fetch(); use $env for environment access; drop require() entirely.`,
						});
						break;
					}
				}
			}
		}

		// Rule: empty Set node.
		if (nodeType && SET_NODE_TYPES.has(nodeType)) {
			const values = params.values as Record<string, unknown> | undefined;
			const assignments = params.assignments as
				| { assignments?: unknown[] }
				| undefined;
			const valueCount =
				(Array.isArray(values?.string) ? values!.string.length : 0) +
				(Array.isArray(values?.number) ? values!.number.length : 0) +
				(Array.isArray(values?.boolean) ? values!.boolean.length : 0) +
				(Array.isArray(assignments?.assignments)
					? assignments!.assignments!.length
					: 0);
			if (valueCount === 0) {
				issues.push({
					severity: "warning",
					node: nodeName,
					message:
						"Set node has no values configured. It will pass items through unchanged — likely a leftover scaffold node.",
				});
			}
		}

		// Rule: webhook node using a test-only path in an active workflow.
		if (
			nodeType &&
			WEBHOOK_TYPES.has(nodeType) &&
			isActive &&
			typeof params.path === "string" &&
			/^test[-_/]/i.test(params.path as string)
		) {
			issues.push({
				severity: "warning",
				node: nodeName,
				message: `Webhook path "${params.path}" starts with 'test'. Active workflows expose the production URL — this path will be live. Rename to something stable.`,
			});
		}

		// Rule: HTTP Request with method + body mismatch.
		if (nodeType && HTTP_REQUEST_TYPES.has(nodeType)) {
			const method = ((params.method as string) ?? "GET").toUpperCase();
			const sendBody = params.sendBody === true;
			const hasBody =
				params.body !== undefined ||
				params.bodyParameters !== undefined ||
				params.jsonBody !== undefined;
			if (method === "GET" && (sendBody || hasBody)) {
				issues.push({
					severity: "warning",
					node: nodeName,
					message:
						"HTTP Request method is GET but a body is configured. Most servers ignore GET bodies and some reject them outright. Switch to POST/PUT or drop the body.",
				});
			}
			if (
				(method === "POST" || method === "PUT" || method === "PATCH") &&
				!sendBody &&
				!hasBody
			) {
				issues.push({
					severity: "warning",
					node: nodeName,
					message: `HTTP Request method is ${method} but no body is configured. Either enable 'Send Body' or switch to GET.`,
				});
			}
		}

		// Rule: rate-sensitive node with no retry/wait wiring.
		if (
			nodeType &&
			RATE_SENSITIVE_TYPES.has(nodeType) &&
			!n.retryOnFail &&
			!n.continueOnFail
		) {
			issues.push({
				severity: "warning",
				node: nodeName,
				message: `Node type "${nodeType}" hits a rate-limited API and has neither retryOnFail nor continueOnFail set. A 429 from upstream will halt the whole workflow. Enable Retry on Fail (Settings tab) or wrap in Loop Over Items with a Wait node.`,
			});
		}

		// Rule: credential drift — credentials object names a credential that
		// the node type doesn't expect. The credential property name should
		// roughly match the node type's domain.
		if (n.credentials && typeof n.credentials === "object" && nodeType) {
			const creds = n.credentials as Record<string, unknown>;
			const credKeys = Object.keys(creds);
			const baseType = nodeType.split(".").pop()?.toLowerCase() ?? "";
			const lowerKeys = credKeys.map((k) => k.toLowerCase());
			const matches = lowerKeys.some(
				(k) =>
					k.startsWith(baseType) || baseType.startsWith(k.replace(/api$/, "")),
			);
			if (credKeys.length > 0 && !matches && baseType.length > 3) {
				issues.push({
					severity: "warning",
					node: nodeName,
					message: `Node type "${nodeType}" has credentials [${credKeys.join(", ")}] which don't look like they match the node domain. Likely a copy-paste from a different node — verify the credential is the right one.`,
				});
			}
		}

		// Rule: expression staleness — references a node by name that doesn't
		// exist in this workflow.
		const expressionTargets = collectExpressionNodeRefs(params);
		for (const ref of expressionTargets) {
			if (!nodeNames.has(ref) && ref !== nodeName) {
				const stillToScan = nodes.some(
					(other) =>
						other &&
						typeof other === "object" &&
						(other as Record<string, unknown>).name === ref,
				);
				if (!stillToScan) {
					issues.push({
						severity: "error",
						node: nodeName,
						message: `Expression references node "${ref}" which doesn't exist in this workflow. Likely renamed or deleted upstream. Update the \`$('${ref}')\` reference.`,
					});
				}
			}
		}

		if (nodeType && IF_NODE_TYPES.has(nodeType)) {
			const conditions = params.conditions as Record<string, unknown> | undefined;
			const looksLikeV1 =
				conditions !== undefined &&
				typeof conditions === "object" &&
				!Array.isArray(conditions) &&
				("boolean" in conditions ||
					"string" in conditions ||
					"number" in conditions ||
					"dateTime" in conditions);
			if (looksLikeV1) {
				issues.push({
					severity: "warning",
					node: nodeName,
					message:
						"IF node uses v1 condition schema (`conditions.boolean[]` etc.). Bump `typeVersion` to 2+ and switch to the v2 condition shape (`conditions.options`, `conditions.conditions[]`, `conditions.combinator`).",
				});
			}
		}
	}

	for (const [src, conf] of Object.entries(connections)) {
		if (!nodeNames.has(src)) {
			issues.push({
				severity: "error",
				message: `Connection from unknown node "${src}".`,
			});
			continue;
		}
		const main = (conf as { main?: unknown })?.main;
		if (!Array.isArray(main)) continue;
		for (const branch of main) {
			if (!Array.isArray(branch)) continue;
			for (const conn of branch) {
				if (
					!conn ||
					typeof conn !== "object" ||
					typeof (conn as Record<string, unknown>).node !== "string"
				) {
					issues.push({
						severity: "error",
						message: `Malformed connection from "${src}".`,
					});
					continue;
				}
				const target = (conn as { node: string }).node;
				if (!nodeNames.has(target)) {
					issues.push({
						severity: "error",
						message: `Connection from "${src}" points to missing node "${target}".`,
					});
				}
			}
		}
	}

	return formatResult(issues);
}

function safeParse(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

/**
 * Walk a parameters object and collect every `$('Node Name')` reference
 * inside `={{ ... }}` expressions. Returns the node names referenced.
 */
function collectExpressionNodeRefs(
	params: Record<string, unknown>,
): Set<string> {
	const refs = new Set<string>();
	const re = /\$\(\s*['"]([^'"]+)['"]\s*\)/g;
	function walk(v: unknown) {
		if (typeof v === "string") {
			if (!v.startsWith("=")) return;
			for (const m of v.matchAll(re)) {
				refs.add(m[1]);
			}
		} else if (Array.isArray(v)) {
			for (const item of v) walk(item);
		} else if (v && typeof v === "object") {
			for (const inner of Object.values(v as Record<string, unknown>)) {
				walk(inner);
			}
		}
	}
	walk(params);
	return refs;
}

function formatResult(issues: Issue[]) {
	const error_count = issues.filter((i) => i.severity === "error").length;
	const warning_count = issues.filter((i) => i.severity === "warning").length;
	const structuredContent = { issues, error_count, warning_count };

	if (issues.length === 0) {
		return {
			content: [{ type: "text" as const, text: "no issues found" }],
			structuredContent,
		};
	}
	const lines = issues.map((i) => {
		const tag = i.severity.toUpperCase();
		const where = i.node ? `[${i.node}] ` : "";
		return `${tag} ${where}${i.message}`;
	});
	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		structuredContent,
	};
}
