import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Y2McpConfig } from "../config.js";
import {
	findOperationById,
	findOperationByPath,
	loadOpenApi,
	toResolvedOperation,
} from "../openapi.js";
import { errorResult, formatJson, textResult } from "../text.js";
import type { Y2Client } from "../y2-client.js";
import { readOnlyExternalToolAnnotations } from "./metadata.js";

const operationInput = {
	operationId: z.string().min(1).max(128).optional().describe("Y2 OpenAPI operationId."),
	path: z
		.string()
		.min(1)
		.max(512)
		.optional()
		.describe("Y2 API path or full Y2 API URL, such as /reports or /api/v1/reports."),
	method: z
		.enum(["get", "post", "put", "patch", "delete"])
		.optional()
		.describe("HTTP method to use with path."),
};

export function registerOpenApiTools(server: McpServer, client: Y2Client, config: Y2McpConfig) {
	server.registerTool(
		"y2_get_openapi_operation",
		{
			title: "Get Y2 OpenAPI Operation",
			description:
				"Return one Y2 OpenAPI operation by operationId or path plus method, with resolved parameters and request-body details. Does not require Y2_API_KEY.",
			inputSchema: operationInput,
			annotations: readOnlyExternalToolAnnotations,
		},
		async ({ operationId, path, method }) => {
			try {
				if (!operationId && (!path || !method)) {
					throw new Error("Provide operationId or both path and method.");
				}
				const spec = await loadOpenApi(client);
				const resolved = operationId
					? findOperationById(spec, operationId)
					: findOperationByPath(spec, path ?? "", method ?? "");
				if (!resolved) {
					throw new Error("OpenAPI operation not found.");
				}
				return textResult(formatJson(toResolvedOperation(spec, resolved.path, resolved.method), config));
			} catch (error) {
				return errorResult(error, config);
			}
		},
	);
}
