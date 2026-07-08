import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer) {
	server.registerPrompt(
		"integrate-y2-api",
		{
			title: "Integrate Y2 API",
			description: "Guide an agent through a safe Y2 API integration.",
			argsSchema: {
				task: z.string().optional().describe("Optional integration task or target workflow."),
			},
		},
		({ task }) => ({
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
		}),
	);

	server.registerPrompt(
		"ask-y2-brief",
		{
			title: "Ask Y2 Brief",
			description: "Ask Agent Y2 for a concise intelligence brief.",
			argsSchema: {
				topic: z.string().min(1).max(256).describe("Briefing topic for Agent Y2."),
			},
		},
		({ topic }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Ask Agent Y2 for a concise intelligence brief about: ${topic}`,
					},
				},
			],
		}),
	);

	server.registerPrompt(
		"debug-y2-api-call",
		{
			title: "Debug Y2 API Call",
			description: "Debug a Y2 API integration failure before guessing.",
			argsSchema: {
				statusCode: z.string().optional().describe("Observed HTTP status code."),
				endpoint: z.string().optional().describe("Y2 endpoint or URL being debugged."),
			},
		},
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
