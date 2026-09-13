import type { Y2McpConfig } from "./config.js";
import { formatToolError } from "./errors.js";

export function limitText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} characters]`;
}

export function formatJson(value: unknown, config: Y2McpConfig): string {
	return limitText(JSON.stringify(value, null, 2), config.maxResponseChars);
}

export async function formatResponse(response: Response, config: Y2McpConfig): Promise<string> {
	if (response.status >= 300 && response.status < 400) {
		return formatJson({ status: response.status, location: response.headers.get("location") }, config);
	}
	const text = await response.text();
	if (!text) return formatJson({ status: response.status }, config);
	const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
	if (contentType === "application/json" || contentType?.endsWith("+json")) {
		try {
			return formatJson(JSON.parse(text), config);
		} catch {
			// Preserve a malformed JSON response as text for inspection.
		}
	}
	return limitText(text, config.maxResponseChars);
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
