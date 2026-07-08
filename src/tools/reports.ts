import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Y2McpConfig } from "../config.js";
import { errorResult, formatJson, textResult } from "../text.js";
import type { Y2Client } from "../y2-client.js";
import { readOnlyExternalToolAnnotations } from "./metadata.js";

const listReportsInput = {
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
		async ({ profileId, limit }) => {
			try {
				const data = await client.requestJson("/api/v1/reports", {
					query: {
						limit: String(limit),
						...(profileId ? { profileId } : {}),
					},
				});
				return textResult(formatJson(data, config));
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
		async ({ reportId }) => {
			try {
				const data = await client.requestJson(`/api/v1/reports/${encodeURIComponent(reportId)}`);
				return textResult(formatJson(data, config));
			} catch (error) {
				return errorResult(error, config);
			}
		},
	);
}
