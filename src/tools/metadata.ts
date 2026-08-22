import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export const readOnlyExternalToolAnnotations = {
	readOnlyHint: true,
	openWorldHint: true,
} satisfies ToolAnnotations;

export const agentActionToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: true,
} satisfies ToolAnnotations;

export const additiveExternalToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true,
} satisfies ToolAnnotations;

export const destructiveExternalToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: true,
} satisfies ToolAnnotations;
