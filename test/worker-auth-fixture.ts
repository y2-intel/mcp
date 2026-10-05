import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, type Request, type RequestInit, Response } from "miniflare";

export const ORIGIN = "https://mcp.test";
export const RESOURCE = `${ORIGIN}/mcp`;
export const REDIRECT = "https://client.test/callback";
export const CIMD = "https://client.test/client-metadata.json";
const GATEWAY_SECRET = "fixture-only-gateway-secret-not-a-live-credential";
export const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
export function required<T>(value: T | null | undefined): T {
	assert(
		value !== undefined && value !== null,
		"Expected fixture value to exist",
	);
	return value;
}
const key = () => `y2_${Buffer.from(randomBytes(32)).toString("hex")}`;
export const json = async (response: {
	json(): Promise<unknown>;
}): Promise<Record<string, unknown>> => {
	const value = await response.json();
	assert(value && typeof value === "object" && !Array.isArray(value));
	return value as Record<string, unknown>;
};
export const rpcJson = async (response: {
	text(): Promise<string>;
}): Promise<Record<string, unknown>> => {
	const text = await response.text();
	const data = text.startsWith("event:")
		? text
				.split("\n")
				.find((line) => line.startsWith("data: "))
				?.slice(6)
		: text;
	assert(data, "MCP response must contain a JSON-RPC message");
	const value = JSON.parse(data);
	assert(value && typeof value === "object" && !Array.isArray(value));
	return value as Record<string, unknown>;
};

type Identity = {
	credentialHash: string;
	grantId: string;
	clientId: string;
	resource: string;
	kind: string;
	attemptId: string;
};
type Connection = {
	apiKey: string;
	connectionId: string;
	scopes: string[];
	active: boolean;
};
type Redemption = Identity & {
	state: "pending" | "spent";
	connection: Connection;
};
type Ticket = {
	requestId: string;
	challenge: string;
	scopes: string[];
	used: boolean;
};
export type Client = {
	clientId: string;
	clientSecret?: string;
	method: "none" | "client_secret_basic" | "client_secret_post";
};
export type Flow = {
	client: Client;
	requestId: string;
	cookie: string;
	verifier: string;
	code: string;
	ticket: string;
};

// Only the external Y2 backend is replaced. OAuth, browser cookies, PKCE,
// encryption, provider KV, and the Worker itself execute inside workerd.
export class BackendFixture {
	tickets = new Map<string, Ticket>();
	connections = new Map<string, Connection>();
	redemptions = new Map<string, Redemption>();
	requests: string[] = [];
	failClaim = false;
	malformedClaim = false;
	malformedFinalize = false;
	failFinalize = false;
	beforeFinalize?: () => Promise<void>;

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.href === CIMD)
			return Response.json({
				client_id: CIMD,
				client_name: "Metadata assistant",
				redirect_uris: [REDIRECT],
				token_endpoint_auth_method: "none",
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
			});
		assert.equal(
			url.origin,
			"https://api.test",
			"Unexpected outbound request: tests never contact live services",
		);
		this.requests.push(url.pathname);
		const body = request.method === "POST" ? await json(request) : {};
		if (url.pathname === "/mcp/connection/exchange") {
			const ticket = this.tickets.get(String(body.code));
			if (
				!ticket ||
				ticket.used ||
				ticket.requestId !== body.requestId ||
				hash(String(body.verifier)) !== ticket.challenge
			)
				return Response.json({ error: "invalid_grant" }, { status: 400 });
			ticket.used = true;
			const connection: Connection = {
				apiKey: key(),
				connectionId: `cnn_${Buffer.from(randomBytes(12)).toString("hex")}`,
				scopes: ticket.scopes,
				active: true,
			};
			this.connections.set(connection.apiKey, connection);
			return Response.json({
				...connection,
				userId: "test-user",
				workspaceName: "Test workspace",
			});
		}
		if (url.pathname === "/mcp/connection/replay") {
			if (request.headers.get("X-Y2-MCP-Gateway-Secret") !== GATEWAY_SECRET)
				return Response.json({ error: "unauthorized" }, { status: 401 });
			const spent = this.redemptions.get(String(body.credentialHash));
			const replayed = Boolean(
				spent &&
					(spent.state === "spent" || spent.kind === "authorization_code") &&
					spent.clientId === body.clientId &&
					spent.resource === body.resource &&
					spent.kind === body.kind,
			);
			if (replayed && spent) spent.connection.active = false;
			return Response.json({ replayed });
		}
		const connection = this.connections.get(
			(request.headers.get("Authorization") ?? "").replace(/^Bearer /, ""),
		);
		if (!connection?.active)
			return Response.json({ status: "invalid_grant" }, { status: 401 });
		if (url.pathname === "/mcp/connection")
			return Response.json({
				connectionId: connection.connectionId,
				workspaceName: "Test workspace",
				resource: RESOURCE,
				scopes: connection.scopes,
			});
		const identity = body as Identity;
		const existing = this.redemptions.get(identity.credentialHash);
		if (url.pathname === "/mcp/connection/redeem") {
			if (this.failClaim)
				return Response.json({ error: "unavailable" }, { status: 503 });
			if (existing?.state === "pending")
				return Response.json({ status: "pending" }, { status: 409 });
			if (existing) {
				connection.active = false;
				return Response.json({ status: "invalid_grant" }, { status: 401 });
			}
			this.redemptions.set(identity.credentialHash, {
				...identity,
				state: "pending",
				connection,
			});
			if (this.malformedClaim) return Response.json({ status: "wrong" });
			return Response.json({ status: "claimed" });
		}
		if (url.pathname === "/mcp/connection/finalize") {
			await this.beforeFinalize?.();
			if (!connection.active)
				return Response.json({ status: "invalid_grant" }, { status: 401 });
			if (this.malformedFinalize) return Response.json({ status: "wrong" });
			if (this.failFinalize)
				return Response.json({ error: "unavailable" }, { status: 503 });
			if (!existing || existing.attemptId !== identity.attemptId)
				return Response.json({ status: "invalid_grant" }, { status: 401 });
			existing.state = "spent";
			return Response.json({ status: "spent" });
		}
		if (url.pathname === "/mcp/connection/release") {
			const released =
				existing?.state === "pending" &&
				existing.attemptId === identity.attemptId;
			if (released) this.redemptions.delete(identity.credentialHash);
			return Response.json({ released });
		}
		if (url.pathname === "/api/v1/profiles")
			return Response.json({
				data: [
					{
						id: "prf_example123",
						name: "Test profile",
						description: "Fixture evidence",
					},
				],
			});
		if (url.pathname === "/api/v1/reports")
			return Response.json({
				data: [{ id: "rep_example123", title: "Test report" }],
			});
		return Response.json(
			{ error: "Unknown fixture endpoint" },
			{ status: 404 },
		);
	}
}

let bundled: Promise<string> | undefined;
async function bundle(): Promise<string> {
	bundled ??= build({
		entryPoints: ["worker/index.ts"],
		bundle: true,
		write: false,
		format: "esm",
		platform: "browser",
		target: "es2022",
		conditions: ["workerd", "worker", "browser"],
		external: ["cloudflare:workers", "node:*"],
	}).then((result) => required(result.outputFiles[0]).text);
	return bundled;
}

export class WorkerFixture {
	private constructor(
		readonly runtime: Miniflare,
		readonly backend: BackendFixture,
	) {}
	static async create(gatewaySecret = GATEWAY_SECRET) {
		const backend = new BackendFixture();
		const runtime = new Miniflare({
			cf: false,
			telemetry: { enabled: false },
			workers: [
				{
					config: {
						name: "oauth-test",
						compatibilityDate: "2026-10-05",
						compatibilityFlags: [
							"nodejs_compat",
							"global_fetch_strictly_public",
						],
						manifest: {
							mainModule: "index.js",
							modules: {
								"index.js": { type: "esm", contents: await bundle() },
							},
						},
						env: {
							MCP_ORIGIN: { type: "text", value: ORIGIN },
							Y2_ORIGIN: { type: "text", value: "https://y2.test" },
							API_ORIGIN: { type: "text", value: "https://api.test" },
							MCP_GATEWAY_SECRET: { type: "text", value: gatewaySecret },
							OAUTH_KV: { type: "kv", id: "test-oauth" },
							ASSETS: {
								type: "fetcher",
								handler: () =>
									new Response("<html>Test view</html>", {
										headers: { "Content-Type": "text/html" },
									}),
							},
						},
					},
					dev: {
						outboundService: {
							type: "fetcher",
							handler: (request) => backend.fetch(request),
						},
					},
				},
			],
		});
		return new WorkerFixture(runtime, backend);
	}
	fetch(path: string, init?: RequestInit) {
		return this.runtime.dispatchFetch(`${ORIGIN}${path}`, {
			redirect: "manual",
			...init,
		});
	}
	dispose() {
		return this.runtime.dispose();
	}
	async register(method: Client["method"] = "none"): Promise<Client> {
		const response = await this.fetch("/oauth/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				client_name: "Fixture assistant",
				redirect_uris: [REDIRECT],
				token_endpoint_auth_method: method,
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
			}),
		});
		assert.equal(response.status, 201);
		const body = await json(response);
		assert.equal(typeof body.client_id, "string");
		return {
			clientId: String(body.client_id),
			clientSecret:
				typeof body.client_secret === "string" ? body.client_secret : undefined,
			method,
		};
	}
	async begin(
		client: Client,
		scopes = ["profiles:read", "reports:read", "offline_access"],
		overrides: Record<string, string | null> = {},
	) {
		const verifier = Buffer.from(randomBytes(32)).toString("base64url");
		const query = new URLSearchParams({
			response_type: "code",
			client_id: client.clientId,
			redirect_uri: REDIRECT,
			scope: scopes.join(" "),
			state: "state-anti-csrf",
			resource: RESOURCE,
			code_challenge: createHash("sha256").update(verifier).digest("base64url"),
			code_challenge_method: "S256",
		});
		for (const [name, value] of Object.entries(overrides))
			value === null ? query.delete(name) : query.set(name, value);
		const response = await this.fetch(`/authorize?${query}`);
		assert.equal(
			response.status,
			302,
			`Authorization response: ${await response.clone().text()}`,
		);
		const location = new URL(required(response.headers.get("Location")));
		assert.equal(location.origin, "https://y2.test");
		const requestId = required(location.searchParams.get("request"));
		assert.match(requestId, /^[a-f0-9]{64}$/);
		const setCookie = required(response.headers.get("Set-Cookie"));
		const cookie = setCookie.split(";")[0];
		assert(cookie);
		assert.match(setCookie, /HttpOnly/i);
		assert.match(setCookie, /Secure/i);
		const detailsResponse = await this.fetch(`/oauth/request/${requestId}`, {
			headers: { Origin: "https://y2.test" },
		});
		assert.equal(detailsResponse.status, 200);
		const details = await json(detailsResponse);
		assert.equal(details.clientId, client.clientId);
		assert.equal(details.handle, undefined);
		assert.equal(details.verifier, undefined);
		assert.match(String(details.challenge), /^[a-f0-9]{64}$/);
		const ticket = key();
		this.backend.tickets.set(ticket, {
			requestId,
			challenge: String(details.challenge),
			scopes: scopes.filter((scope) => scope !== "offline_access"),
			used: false,
		});
		return { client, requestId, cookie, verifier, ticket };
	}
	complete(
		flow: Omit<Flow, "code">,
		decision = "approve",
		headers: Record<string, string> = {},
	) {
		return this.fetch("/oauth/complete", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: ORIGIN,
				Cookie: flow.cookie,
				...headers,
			},
			body: JSON.stringify({
				requestId: flow.requestId,
				decision,
				...(decision === "approve" ? { code: flow.ticket } : {}),
			}),
		});
	}
	async authorize(client: Client, scopes?: string[]): Promise<Flow> {
		const flow = await this.begin(client, scopes);
		const response = await this.complete(flow);
		assert.equal(
			response.status,
			200,
			`${await response.clone().text()} Backend calls: ${this.backend.requests.join(", ")}; ticket used: ${this.backend.tickets.get(flow.ticket)?.used}`,
		);
		const redirect = new URL(String((await json(response)).redirectTo));
		assert.equal(redirect.origin, "https://client.test");
		assert.equal(redirect.searchParams.get("state"), "state-anti-csrf");
		assert.equal(redirect.searchParams.get("iss"), ORIGIN);
		return { ...flow, code: required(redirect.searchParams.get("code")) };
	}
	token(client: Client, parameters: Record<string, string>) {
		const form = new URLSearchParams({ resource: RESOURCE, ...parameters });
		const headers: Record<string, string> = {
			"Content-Type": "application/x-www-form-urlencoded",
		};
		if (client.method === "client_secret_basic")
			headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret ?? "")}`).toString("base64")}`;
		else {
			form.set("client_id", client.clientId);
			if (client.method === "client_secret_post")
				form.set("client_secret", client.clientSecret ?? "");
		}
		return this.fetch("/oauth/token", {
			method: "POST",
			headers,
			body: form.toString(),
		});
	}
	exchange(flow: Flow, codeVerifier = flow.verifier) {
		return this.token(flow.client, {
			grant_type: "authorization_code",
			code: flow.code,
			redirect_uri: REDIRECT,
			code_verifier: codeVerifier,
		});
	}
	rpc(token: string, method: string, params: Record<string, unknown> = {}) {
		return this.fetch("/mcp", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				"MCP-Protocol-Version": "2025-06-18",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
		});
	}
}
