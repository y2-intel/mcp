import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Y2McpConfig } from "../config.js";
import { errorResult, formatJson, textResult } from "../text.js";
import type { Y2Client } from "../y2-client.js";

const listReportsInput = {
	profileId: z.string().min(1).max(256).optional(),
	limit: z.number().int().min(1).max(5).default(5),
};

const getReportInput = {
	reportId: z.string().min(1).max(256),
};

export function registerReportTools(server: McpServer, client: Y2Client, config: Y2McpConfig) {
	server.tool(
		"y2_list_reports",
		"List recent Y2 reports. Requires reports:read.",
		listReportsInput,
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

	server.tool(
		"y2_get_report",
		"Get one Y2 report by ID. Requires reports:read.",
		getReportInput,
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
