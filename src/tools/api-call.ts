import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Y2McpConfig } from "../config.js";
import {
	buildRequestFromInput,
	findOperationByPath,
	findOperationById,
	loadOpenApi,
	summarizeOperations,
	toApiPath,
} from "../openapi.js";
import { errorResult, formatJson, formatResponse, textResult } from "../text.js";
import type { Y2Client } from "../y2-client.js";
import { destructiveExternalToolAnnotations, readOnlyExternalToolAnnotations } from "./metadata.js";

const listInput = {};

const callInput = {
	operationId: z
		.string()
		.min(1)
		.max(128)
		.optional()
		.describe("Y2 OpenAPI operationId from y2_list_api_operations."),
	path: z
		.string()
		.min(1)
		.max(512)
		.optional()
		.describe("Y2 API path or full Y2 API URL, such as /reports or /api/v1/reports. Use with method."),
	method: z
		.enum(["get", "post", "put", "patch", "delete"])
		.optional()
		.describe("HTTP method to use with path."),
	parameters: z
		.record(z.unknown())
		.optional()
		.describe(
			"Parameter values keyed by the operation's parameter names: path params are interpolated, query params serialized (arrays become comma-separated), header params attached as headers.",
		),
	body: z
		.record(z.unknown())
		.optional()
		.describe("JSON request body for operations that accept one, per the Y2 OpenAPI schema."),
};

export function registerApiCallTools(server: McpServer, client: Y2Client, config: Y2McpConfig) {
	server.registerTool(
		"y2_list_api_operations",
		{
			title: "List Y2 API Operations",
			description:
				"List every operation in the published Y2 OpenAPI document with operationId, method, and path. Does not require Y2_API_KEY. Pair with y2_call_api or y2_get_openapi_operation for full parameter details.",
			inputSchema: listInput,
			annotations: readOnlyExternalToolAnnotations,
		},
		async () => {
			try {
				const spec = await loadOpenApi(client);
				return textResult(formatJson(summarizeOperations(spec), config));
			} catch (error) {
				return errorResult(error, config);
			}
		},
	);

	server.registerTool(
		"y2_call_api",
		{
			title: "Call Y2 API Operation",
			description:
				"Call any Y2 API operation by operationId (or path plus method), building path/query/header parameters and JSON body from the live Y2 OpenAPI document. Requires Y2_API_KEY except for public endpoints such as x402 receipts. Mutations require Y2_MCP_ENABLE_WRITE_TOOLS=1; Agent Y2 endpoints require Y2_MCP_ENABLE_AGENT=1.",
			inputSchema: callInput,
			annotations: config.enableWriteTools || config.enableAgentTool
				? destructiveExternalToolAnnotations
				: readOnlyExternalToolAnnotations,
		},
		async ({ operationId, path, method, parameters, body }) => {
			try {
				if (!operationId && (!path || !method)) {
					throw new Error("Provide operationId or both path and method.");
				}
				const spec = await loadOpenApi(client);
				const operation = operationId
					? findOperationById(spec, operationId)
					: findOperationByPath(spec, path ?? "", method ?? "");
				if (!operation) {
					throw new Error(
						`OpenAPI operation not found. Use y2_list_api_operations to discover valid operationIds.`,
					);
				}

				const operationPath = toApiPath(operation.path);
				const isAgent = operation.requiredScopes.includes("agent:y2")
					|| operationPath.startsWith("/api/v1/agent-y2/")
					|| operationPath === "/api/v1/chat/completions";
				const isReadOnly = operation.method === "get"
					|| (operation.method === "post" && operationPath === "/api/v2/intel/knowledge/retrieve");
				if (isAgent && !config.enableAgentTool) {
					throw new Error("Set Y2_MCP_ENABLE_AGENT=1 to call Agent Y2 operations.");
				}
				if (!isAgent && !isReadOnly && !config.enableWriteTools) {
					throw new Error("Set Y2_MCP_ENABLE_WRITE_TOOLS=1 to call write operations.");
				}
				const request = buildRequestFromInput(operation, parameters ?? {});
				const requestBody = body ?? request.body;
				if (operation.requestBodyRequired && requestBody === undefined) {
					throw new Error("This OpenAPI operation requires a JSON request body. Use y2_get_openapi_operation to inspect its schema.");
				}

				const response = await client.request(toApiPath(request.path), {
					method: operation.method.toUpperCase(),
					query: request.query,
					headers: request.headers,
					body: requestBody,
					auth: operation.requiresApiKey,
				});

				return textResult(await formatResponse(response, config));
			} catch (error) {
				return errorResult(error, config);
			}
		},
	);
}
