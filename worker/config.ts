import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";

export interface Env {
	OAUTH_KV: KVNamespace;
	ASSETS: Fetcher;
	OAUTH_PROVIDER: OAuthHelpers;
	MCP_ORIGIN: string;
	Y2_ORIGIN: string;
	API_ORIGIN: string;
	MCP_GATEWAY_SECRET?: string;
	REQUEST_LIMITER?: RateLimit;
}
export const READ_SCOPES = [
	"profiles:read",
	"reports:read",
	"osint:read",
	"intel:explorer",
	"intel:finint",
	"intel:cyber",
] as const;
export const propsSchema = z.object({
	apiKey: z.string().regex(/^y2_[a-f0-9]{64}$/),
	connectionId: z.string().startsWith("cnn_"),
	workspaceName: z.string().max(200),
});
export type ConnectionProps = z.infer<typeof propsSchema>;
export const noStore = {
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
};
export async function readBounded(
	body: ReadableStream<Uint8Array> | null,
	limit = 65_536,
): Promise<string> {
	if (!body) throw new Error("Empty response");
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				await reader.cancel();
				throw new Error("Response exceeds size limit");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}
export async function digest(value: string): Promise<string> {
	return Array.from(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
		),
		(b) => b.toString(16).padStart(2, "0"),
	).join("");
}
export function randomHex(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}
export async function backend(
	env: Env,
	path: string,
	body?: unknown,
	key?: string,
): Promise<Response> {
	const gatewayHeaders: Record<string, string> = {};
	if (path === "/mcp/connection/replay") {
		if (!env.MCP_GATEWAY_SECRET || env.MCP_GATEWAY_SECRET.length < 32)
			throw new Error("Replay verification is not configured");
		gatewayHeaders["X-Y2-MCP-Gateway-Secret"] = env.MCP_GATEWAY_SECRET;
	}
	return fetch(`${env.API_ORIGIN}${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			Accept: "application/json",
			...gatewayHeaders,
			...(key ? { Authorization: `Bearer ${key}` } : {}),
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		redirect: "manual",
		signal: AbortSignal.timeout(15_000),
	});
}
