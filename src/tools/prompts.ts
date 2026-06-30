import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer) {
	server.prompt("integrate-y2-api", { task: z.string().optional() }, ({ task }) => ({
		messages: [
			{
				role: "user",
				content: {
					type: "text",
					text: [
						"Integrate the Y2 API into this codebase.",
						"Read y2://docs/index, y2://quickstart, and y2://openapi first.",
						"Keep Y2_API_KEY server-side or in local MCP environment only.",
						"Choose the narrowest scopes needed and handle 401, 402, 403, 429, and 5xx.",
						task ? `Task: ${task}` : "",
					]
						.filter(Boolean)
						.join("\n"),
				},
			},
		],
	}));

	server.prompt("ask-y2-brief", { topic: z.string().min(1).max(256) }, ({ topic }) => ({
		messages: [
			{
				role: "user",
				content: {
					type: "text",
					text: `Ask Agent Y2 for a concise intelligence brief about: ${topic}`,
				},
			},
		],
	}));

	server.prompt(
		"debug-y2-api-call",
		{ statusCode: z.string().optional(), endpoint: z.string().optional() },
		({ statusCode, endpoint }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: [
							"Debug this Y2 API integration before guessing.",
							"Check endpoint, method, scopes, API key placement, status code, rate-limit headers, and response body.",
							endpoint ? `Endpoint: ${endpoint}` : "",
							statusCode ? `Status code: ${statusCode}` : "",
						]
							.filter(Boolean)
							.join("\n"),
					},
				},
			],
		}),
	);
}
