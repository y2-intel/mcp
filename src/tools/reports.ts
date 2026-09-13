import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Y2McpConfig } from "../config.js";
import { errorResult, formatResponse, textResult } from "../text.js";
import type { Y2Client } from "../y2-client.js";
import { readOnlyExternalToolAnnotations } from "./metadata.js";

const listReportsInput = {
	cursor: z.string().min(1).optional().describe("Opaque cursor returned by a previous response."),
	format: z.enum(["json", "ndjson"]).optional().describe("Response representation."),
	profileId: z
		.string()
		.min(1)
		.max(256)
		.optional()
		.describe("Optional Y2 profile ID to filter reports."),
	limit: z
		.number()
		.int()
		.min(1)
		.max(5)
		.default(5)
		.describe("Maximum reports to return. Y2 MCP caps this at 5."),
};

const getReportInput = {
	reportId: z.string().min(1).max(256).describe("Y2 report ID to retrieve."),
	include: z.string().min(1).optional().describe("Comma-separated report expansions, such as content,sources."),
	view: z.enum(["agent"]).optional().describe("Agent-oriented report view."),
	format: z.enum(["markdown"]).optional().describe("Return the report as Markdown."),
};

export function registerReportTools(server: McpServer, client: Y2Client, config: Y2McpConfig) {
	server.registerTool(
		"y2_list_reports",
		{
			title: "List Y2 Reports",
			description: "List recent Y2 reports. Requires reports:read.",
			inputSchema: listReportsInput,
			annotations: readOnlyExternalToolAnnotations,
		},
		async ({ profileId, limit, cursor, format }) => {
			try {
				const response = await client.request("/api/v1/reports", {
					query: {
						limit: String(limit),
						cursor,
						format,
						...(profileId ? { profileId } : {}),
					},
				});
				return textResult(await formatResponse(response, config));
			} catch (error) {
				return errorResult(error, config);
			}
		},
	);

	server.registerTool(
		"y2_get_report",
		{
			title: "Get Y2 Report",
			description: "Get one Y2 report by ID. Requires reports:read.",
			inputSchema: getReportInput,
			annotations: readOnlyExternalToolAnnotations,
		},
		async ({ reportId, include, view, format }) => {
			try {
				const response = await client.request(`/api/v1/reports/${encodeURIComponent(reportId)}`, {
					query: { include, view, format },
				});
				return textResult(await formatResponse(response, config));
			} catch (error) {
				return errorResult(error, config);
			}
		},
	);
}
