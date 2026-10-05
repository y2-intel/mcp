import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export type ApiToolDefinition = {
	name: string;
	title: string;
	description: string;
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	path: string;
	scopes?: string[];
	inputSchema?: z.ZodRawShape;
	pathParams?: string[];
	queryParams?: string[];
	bodyParam?: string;
	headerParams?: string[];
	auth?: boolean;
	annotations: ToolAnnotations;
};
