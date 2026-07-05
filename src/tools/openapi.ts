import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parse } from "yaml";
import { z } from "zod";
import type { Y2McpConfig } from "../config.js";
import { errorResult, formatJson, textResult } from "../text.js";
import type { Y2Client } from "../y2-client.js";

const operationInput = {
	operationId: z.string().min(1).max(128).optional(),
	path: z.string().min(1).max(512).optional(),
	method: z.enum(["get", "post", "put", "patch", "delete"]).optional(),
};

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function findByOperationId(openApi: unknown, operationId: string): unknown {
	const paths = asRecord(asRecord(openApi).paths);
	for (const [path, pathItem] of Object.entries(paths)) {
		for (const [method, operation] of Object.entries(asRecord(pathItem))) {
			if (asRecord(operation).operationId === operationId) {
				return { path, method, operation };
			}
		}
	}
	return undefined;
}

export function candidateOpenApiPaths(input: string): string[] {
	const pathname = (() => {
		try {
			return new URL(input).pathname;
		} catch {
			return input.startsWith("/") ? input : `/${input}`;
		}
	})();
	const candidates = [pathname];
	if (pathname.startsWith("/api/v1/")) {
		candidates.push(pathname.slice("/api/v1".length));
	}
	return [...new Set(candidates)];
}

function findByPath(openApi: unknown, path: string, method: string): unknown {
	const paths = asRecord(asRecord(openApi).paths);
	for (const candidatePath of candidateOpenApiPaths(path)) {
		const operation = asRecord(paths[candidatePath])[method];
		if (operation) return { path: candidatePath, method, operation };
	}
	return undefined;
}

export function registerOpenApiTools(server: McpServer, client: Y2Client, config: Y2McpConfig) {
	server.tool(
		"y2_get_openapi_operation",
		"Return one Y2 OpenAPI operation by operationId or path plus method. Does not require Y2_API_KEY.",
		operationInput,
		async ({ operationId, path, method }) => {
			try {
				if (!operationId && (!path || !method)) {
					throw new Error("Provide operationId or both path and method.");
				}
				const spec = parse(await client.fetchDocsText("/api/openapi.yaml"));
				const operation = operationId
					? findByOperationId(spec, operationId)
					: findByPath(spec, path ?? "", method ?? "");
				if (!operation) {
					throw new Error("OpenAPI operation not found.");
				}
				return textResult(formatJson(operation, config));
			} catch (error) {
				return errorResult(error, config);
			}
		},
	);
}
