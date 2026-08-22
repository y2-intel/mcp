const DEFAULT_API_BASE_URL = "https://api.y2.dev";
const DEFAULT_DOCS_BASE_URL = "https://y2.dev";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_CHARS = 40_000;

export type Env = Record<string, string | undefined>;

export type Y2McpConfig = {
	apiKey: string | undefined;
	apiBaseUrl: string;
	docsBaseUrl: string;
	timeoutMs: number;
	maxResponseChars: number;
	enableAgentTool: boolean;
	enableWriteTools: boolean;
	debug: boolean;
};

function cleanBaseUrl(value: string | undefined, fallback: string): string {
	const candidate = value?.trim() || fallback;
	const url = new URL(candidate);
	return url.toString().replace(/\/$/, "");
}

function boundedInteger(
	value: string | undefined,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	if (!value) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

export function loadConfig(env: Env = process.env): Y2McpConfig {
	return {
		apiKey: env.Y2_API_KEY?.trim() || undefined,
		apiBaseUrl: cleanBaseUrl(env.Y2_API_BASE_URL, DEFAULT_API_BASE_URL),
		docsBaseUrl: cleanBaseUrl(env.Y2_DOCS_BASE_URL, DEFAULT_DOCS_BASE_URL),
		timeoutMs: boundedInteger(env.Y2_MCP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 300_000),
		maxResponseChars: boundedInteger(
			env.Y2_MCP_MAX_RESPONSE_CHARS,
			DEFAULT_MAX_RESPONSE_CHARS,
			1_000,
			200_000,
		),
		enableAgentTool:
			env.Y2_MCP_ENABLE_AGENT === "1" || env.Y2_MCP_ENABLE_AGENT === "true",
		enableWriteTools:
			env.Y2_MCP_ENABLE_WRITE_TOOLS === "1" ||
			env.Y2_MCP_ENABLE_WRITE_TOOLS === "true",
		debug: env.Y2_MCP_DEBUG === "1" || env.Y2_MCP_DEBUG === "true",
	};
}

export function requireApiKey(config: Y2McpConfig): string {
	if (!config.apiKey) {
		throw new Error("Y2_API_KEY is required for this tool.");
	}
	return config.apiKey;
}

export function redactSecret(secret: string | undefined): string {
	if (!secret) return "";
	if (secret.length <= 8) return "[redacted]";
	return `${secret.slice(0, 4)}...[redacted]...${secret.slice(-4)}`;
}

export function redactKnownSecrets(text: string, config: Y2McpConfig): string {
	if (!config.apiKey) return text;
	return text.split(config.apiKey).join(redactSecret(config.apiKey));
}
