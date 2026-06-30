import type { Y2McpConfig } from "./config.js";
import { formatToolError } from "./errors.js";

export function limitText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} characters]`;
}

export function formatJson(value: unknown, config: Y2McpConfig): string {
	return limitText(JSON.stringify(value, null, 2), config.maxResponseChars);
}

export function textResult(text: string) {
	return {
		content: [{ type: "text" as const, text }],
	};
}

export function errorResult(error: unknown, config: Y2McpConfig) {
	return {
		isError: true,
		content: [{ type: "text" as const, text: formatToolError(error, config) }],
	};
}
