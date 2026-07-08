import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Y2McpConfig } from "../config.js";
import { errorResult, textResult } from "../text.js";
import type { Y2Client } from "../y2-client.js";
import { agentActionToolAnnotations } from "./metadata.js";

const askAgentInput = {
	message: z.string().min(1).max(20_000).describe("Message to send to Agent Y2."),
	threadId: z.string().min(1).max(256).optional().describe("Existing Y2 chat thread ID."),
	source: z.string().min(1).max(128).optional().describe("Optional integration source label."),
	externalUserId: z.string().min(1).max(256).optional().describe("Optional external user ID."),
	externalThreadId: z
		.string()
		.min(1)
		.max(256)
		.optional()
		.describe("Optional external thread ID."),
};

export function registerAgentTools(server: McpServer, client: Y2Client, config: Y2McpConfig) {
	server.registerTool(
		"y2_ask_agent",
		{
			title: "Ask Agent Y2",
			description:
				"Ask Agent Y2. Requires agent:y2. Agent Y2 may use Y2 account tools and mutate resources within the API key's plan and scopes.",
			inputSchema: askAgentInput,
			annotations: agentActionToolAnnotations,
		},
		async (input) => {
			try {
				const response = await client.askAgent(input);
				return textResult(
					[
						response.text || "Agent Y2 returned an empty response.",
						"",
						`Thread ID: ${response.threadId ?? "not returned"}`,
						`Status: ${response.status}`,
					].join("\n"),
				);
			} catch (error) {
				return errorResult(error, config);
			}
		},
	);
}
