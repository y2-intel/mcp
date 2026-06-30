import type { Y2McpConfig } from "./config.js";
import { requireApiKey } from "./config.js";
import { Y2ApiError } from "./errors.js";
import { extractAssistantTextFromStream } from "./stream.js";

type Query = Record<string, string | undefined>;

type RequestOptions = {
	method?: string;
	query?: Query;
	body?: unknown;
	auth?: boolean;
};

export type AskAgentInput = {
	message: string;
	threadId?: string;
	source?: string;
	externalUserId?: string;
	externalThreadId?: string;
};

export type AskAgentResponse = {
	text: string;
	threadId: string | null;
	status: number;
};

function appendQuery(url: URL, query: Query | undefined) {
	if (!query) return;
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined) url.searchParams.set(key, value);
	}
}

function buildUrl(baseUrl: string, path: string, query?: Query): URL {
	const url = new URL(path, `${baseUrl}/`);
	appendQuery(url, query);
	return url;
}

async function responseText(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return "";
	}
}

function errorMessageFromBody(body: string): { message: string; code?: string } {
	if (!body) return { message: "Request failed." };
	try {
		const json = JSON.parse(body) as Record<string, unknown>;
		const message =
			typeof json.message === "string"
				? json.message
				: typeof json.error === "string"
					? json.error
					: typeof (json.error as Record<string, unknown> | undefined)?.message === "string"
						? ((json.error as Record<string, unknown>).message as string)
						: body;
		const code =
			typeof json.code === "string"
				? json.code
				: typeof (json.error as Record<string, unknown> | undefined)?.code === "string"
					? ((json.error as Record<string, unknown>).code as string)
					: undefined;
		return { message, code };
	} catch {
		return { message: body };
	}
}

export class Y2Client {
	readonly #config: Y2McpConfig;

	constructor(config: Y2McpConfig) {
		this.#config = config;
	}

	async fetchDocsText(path: string): Promise<string> {
		const response = await this.fetch(buildUrl(this.#config.docsBaseUrl, path), {
			method: "GET",
		});
		return await this.readOkText(response);
	}

	async requestJson(path: string, options: RequestOptions = {}): Promise<unknown> {
		const response = await this.request(path, options);
		const text = await responseText(response);
		if (!text) return null;
		return JSON.parse(text);
	}

	async askAgent(input: AskAgentInput): Promise<AskAgentResponse> {
		const body = {
			messages: [
				{
					role: "user",
					parts: [{ type: "text", text: input.message }],
				},
			],
			...(input.threadId ? { threadId: input.threadId } : {}),
			...(input.source || input.externalUserId || input.externalThreadId
				? {
						metadata: {
							...(input.source ? { source: input.source } : {}),
							...(input.externalUserId ? { externalUserId: input.externalUserId } : {}),
							...(input.externalThreadId ? { externalThreadId: input.externalThreadId } : {}),
						},
					}
				: {}),
		};
		const response = await this.request("/api/v1/agent-y2/chat/stream", {
			method: "POST",
			body,
		});
		const raw = await responseText(response);
		return {
			text: extractAssistantTextFromStream(raw),
			threadId: response.headers.get("x-thread-id"),
			status: response.status,
		};
	}

	async request(path: string, options: RequestOptions = {}): Promise<Response> {
		const headers = new Headers();
		headers.set("Accept", "application/json, text/event-stream, text/plain");
		if (options.auth !== false) {
			headers.set("Authorization", `Bearer ${requireApiKey(this.#config)}`);
		}
		if (options.body !== undefined) headers.set("Content-Type", "application/json");

		const response = await this.fetch(buildUrl(this.#config.apiBaseUrl, path, options.query), {
			method: options.method ?? (options.body === undefined ? "GET" : "POST"),
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
		await this.throwIfNotOk(response);
		return response;
	}

	async fetch(url: URL, init: RequestInit): Promise<Response> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.#config.timeoutMs);
		try {
			return await fetch(url, { ...init, signal: controller.signal });
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error(`Y2 request timed out after ${this.#config.timeoutMs}ms.`);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	}

	async readOkText(response: Response): Promise<string> {
		await this.throwIfNotOk(response);
		return await responseText(response);
	}

	async throwIfNotOk(response: Response): Promise<void> {
		if (response.ok) return;
		const body = await responseText(response);
		const { message, code } = errorMessageFromBody(body);
		throw new Y2ApiError(message, {
			status: response.status,
			code,
			retryAfter: response.headers.get("retry-after") ?? undefined,
		});
	}
}
