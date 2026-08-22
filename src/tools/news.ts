import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Y2McpConfig } from "../config.js";
import { errorResult, formatJson, textResult } from "../text.js";
import type { Y2Client } from "../y2-client.js";
import { readOnlyExternalToolAnnotations } from "./metadata.js";

const newsInput = {
	topics: z
		.array(z.string().min(1).max(64))
		.max(12)
		.optional()
		.describe("Optional list of Y2 news topics."),
	countryCode: z
		.string()
		.length(2)
		.optional()
		.describe("ISO 3166-1 alpha-2 country code filter, such as US or CN."),
	format: z.enum(["rows"]).optional().describe("Explicit representation override."),
	limit: z
		.number()
		.int()
		.min(1)
		.max(200)
		.default(50)
		.describe("Maximum news items to return. Y2 API caps this at 200."),
};

export function registerNewsTools(server: McpServer, client: Y2Client, config: Y2McpConfig) {
	server.registerTool(
		"y2_list_news",
		{
			title: "List Y2 News",
			description: "List bounded Y2 News Terminal items. Requires news:read.",
			inputSchema: newsInput,
			annotations: readOnlyExternalToolAnnotations,
		},
		async ({ topics, countryCode, format, limit }) => {
			try {
				const data = await client.requestJson("/api/v1/news", {
					query: {
						limit: String(limit),
						...(topics?.length ? { topics: topics.join(",") } : {}),
						...(countryCode ? { countryCode } : {}),
						...(format ? { format } : {}),
					},
				});
				return textResult(formatJson(data, config));
			} catch (error) {
				return errorResult(error, config);
			}
		},
	);
}
