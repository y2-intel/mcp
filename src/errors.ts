import type { Y2McpConfig } from "./config.js";
import { redactKnownSecrets } from "./config.js";

export class Y2ApiError extends Error {
	readonly status: number;
	readonly code: string | undefined;
	readonly retryAfter: string | undefined;

	constructor(message: string, options: { status: number; code?: string; retryAfter?: string }) {
		super(message);
		this.name = "Y2ApiError";
		this.status = options.status;
		this.code = options.code;
		this.retryAfter = options.retryAfter;
	}
}

export function formatToolError(error: unknown, config: Y2McpConfig): string {
	if (error instanceof Y2ApiError) {
		const retry = error.retryAfter ? ` Retry after: ${error.retryAfter}.` : "";
		const code = error.code ? ` ${error.code}:` : "";
		return `Y2 API error ${error.status}.${code} ${redactKnownSecrets(error.message, config)}.${retry}`;
	}
	if (error instanceof Error) {
		return redactKnownSecrets(error.message, config);
	}
	return "Unknown Y2 MCP error.";
}
