import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Env } from "../../worker/config.js";
import { READ_SCOPES } from "../../worker/config.js";
import { resultSchema } from "../../worker/presentation.js";
import { nativeMcp } from "../../worker/tools.js";

const originalFetch = globalThis.fetch;
const props = {
	apiKey: `y2_${"a".repeat(64)}`,
	connectionId: "cnn_fixture",
	workspaceName: "Old workspace name",
};
const env = {
	API_ORIGIN: "https://api.y2.dev",
	MCP_ORIGIN: "https://mcp.y2.dev",
	Y2_ORIGIN: "https://y2.dev",
} as Env;
let calls: URL[];
function fixture(
	body: unknown,
	scopes: string[] = [...READ_SCOPES],
	liveChanges: Record<string, unknown> = {},
) {
	calls = [];
	globalThis.fetch = async (input, init) => {
		const url = new URL(
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url,
		);
		calls.push(url);
		assert.equal(
			new Headers(init?.headers).get("Authorization"),
			`Bearer ${props.apiKey}`,
		);
		assert.equal(init?.redirect, "manual");
		if (url.pathname === "/mcp/connection")
			return Response.json({
				connectionId: props.connectionId,
				workspaceName: "Current workspace",
				resource: `${env.MCP_ORIGIN}/mcp`,
				scopes,
				...liveChanges,
			});
		const response =
			typeof body === "function" ? (body as (url: URL) => unknown)(url) : body;
		return response instanceof Response ? response : Response.json(response);
	};
}
async function rpc(
	method: string,
	params: Record<string, unknown>,
	scopes: string[] = [...READ_SCOPES],
	version = "2026-07-28",
) {
	return nativeMcp(
		new Request(`${env.MCP_ORIGIN}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				"MCP-Protocol-Version": version,
				"Mcp-Method": method,
				...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}),
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method,
				params: {
					...params,
					...(version === "2026-07-28"
						? {
								_meta: {
									"io.modelcontextprotocol/protocolVersion": version,
									"io.modelcontextprotocol/clientCapabilities": {},
									"io.modelcontextprotocol/clientInfo": {
										name: "native-contract-test",
										version: "1.0",
									},
								},
							}
						: {}),
				},
			}),
		}),
		env,
		props,
		scopes,
	);
}
async function call(
	name: string,
	args: Record<string, unknown> = {},
	scopes: string[] = [...READ_SCOPES],
) {
	const response = await rpc("tools/call", { name, arguments: args }, scopes);
	assert.equal(response.status, 200, await response.clone().text());
	return response.json() as Promise<{
		result?: {
			isError?: boolean;
			structuredContent?: unknown;
			content?: Array<{ type: string; text: string }>;
			_meta?: Record<string, unknown>;
		};
		error?: unknown;
	}>;
}
function publicId(prefix: string, index = 1) {
	return `${prefix}_${index.toString(16).padStart(24, "0")}`;
}
function page(data: unknown[], nextCursor: string | null = null) {
	return { data, meta: { page: { nextCursor, hasMore: nextCursor !== null } } };
}
function signal(index: number, domain = "cyber") {
	return {
		id: publicId("sig", index),
		title: `Signal ${index}`,
		signal: "Verified evidence",
		domain,
		priority: "high",
		occurredAt: "2026-10-05T12:00:00Z",
	};
}
function success(value: Awaited<ReturnType<typeof call>>) {
	assert.equal(value.error, undefined, JSON.stringify(value.error));
	assert.notEqual(value.result?.isError, true, JSON.stringify(value.result));
	return resultSchema.parse(value.result?.structuredContent);
}
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("native MCP tool contracts", () => {
	it("preserves connection throttling without invalidating the user's authorization", async () => {
		globalThis.fetch = async () =>
			Response.json(
				{ error: "RATE_LIMITED" },
				{ status: 429, headers: { "Retry-After": "42" } },
			);
		const response = await rpc("tools/list", {});
		assert.equal(response.status, 429);
		assert.equal(response.headers.get("Retry-After"), "42");
		assert.equal(response.headers.get("WWW-Authenticate"), null);
	});
	it("does not ask users to reconnect during a backend outage", async () => {
		globalThis.fetch = async () => new Response(null, { status: 503 });
		const response = await rpc("tools/list", {});
		assert.equal(response.status, 503);
		assert.equal(response.headers.get("WWW-Authenticate"), null);
	});
	it("serves the curated tool catalog through SDK2 HTTP", async () => {
		fixture(page([]));
		const response = await rpc("tools/list", {});
		assert.equal(response.status, 200, await response.clone().text());
		const body = (await response.json()) as {
			result: {
				tools: Array<{
					name: string;
					inputSchema: Record<string, unknown>;
					outputSchema: Record<string, unknown>;
					annotations: Record<string, unknown>;
					_meta: { securitySchemes: unknown[]; ui?: { resourceUri: string } };
				}>;
			};
		};
		assert.equal(body.result.tools.length, 12);
		assert.equal(
			body.result.tools.some((tool) => tool.name === "y2_call_api"),
			false,
		);
		assert.equal(calls.length, 1);
		for (const tool of body.result.tools) {
			assert.equal(tool.inputSchema.type, "object");
			assert.equal(tool.inputSchema.additionalProperties, false);
			assert.equal(tool.outputSchema.type, "object");
			assert.deepEqual(tool.annotations, {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			});
			assert.ok(tool._meta.securitySchemes.length > 0);
			assert.equal(
				Boolean(tool._meta.ui?.resourceUri),
				tool.name.startsWith("y2_render_"),
			);
		}
		assert.doesNotMatch(JSON.stringify(body), /y2_a{64}|cnn_fixture/);
	});
	it("supports the legacy stateless HTTP revision as well as SDK2", async () => {
		fixture(page([]));
		const response = await rpc(
			"tools/list",
			{},
			[...READ_SCOPES],
			"2025-03-26",
		);
		assert.equal(response.status, 200, await response.clone().text());
	});
	it("uses current workspace metadata and exposes only effective scopes to the UI", async () => {
		fixture(page([]));
		const body = await call("y2_connection_info", {}, ["profiles:read"]);
		const result = success(body);
		assert.equal(result.workspaceName, "Current workspace");
		assert.deepEqual(body.result?._meta?.grantedScopes, ["profiles:read"]);
		assert.doesNotMatch(
			JSON.stringify(body),
			/y2_a{64}|cnn_fixture|Old workspace/,
		);
	});
	it("denies a narrowed token before fetching a tool's data", async () => {
		fixture(page([]));
		const body = await call("y2_list_reports", {}, ["profiles:read"]);
		assert.equal(body.result?.isError, true);
		assert.equal(body.result?.structuredContent, undefined);
		assert.match(JSON.stringify(body.result?._meta), /insufficient_scope/);
		assert.equal(calls.length, 1);
	});
	it("rejects mismatched or malformed live connections", async () => {
		for (const changes of [
			{ connectionId: "cnn_other" },
			{ resource: "https://other.test/mcp" },
			{ scopes: ["profiles:write"] },
			{ scopes: [] },
		]) {
			fixture(page([]), [...READ_SCOPES], changes);
			const response = await rpc("tools/list", {});
			assert.equal(response.status, 401);
			assert.match(
				response.headers.get("WWW-Authenticate") ?? "",
				/resource_metadata=.*invalid_token/,
			);
			assert.equal(calls.length, 1);
		}
	});
	it("applies current entitlement narrowing even when the access token retains a wider scope", async () => {
		fixture(page([]), ["profiles:read"]);
		const body = await call("y2_list_reports", {}, [
			"profiles:read",
			"reports:read",
		]);
		assert.equal(body.result?.isError, true);
		assert.equal(calls.length, 1);
	});
	it("requires an explicit permitted signal domain for specialist permissions", async () => {
		for (const [scope, domain] of [
			["intel:cyber", undefined],
			["intel:cyber", "markets"],
			["intel:finint", "geopolitical"],
		] as const) {
			fixture(page([signal(1)]));
			const body = await call("y2_list_signals_v2", domain ? { domain } : {}, [
				scope,
			]);
			assert.equal(body.result?.isError, true);
			assert.equal(calls.length, 1);
		}
	});
	it("matches the API's technology and supply-chain scope alternatives", async () => {
		for (const [scope, domain] of [
			["intel:cyber", "technology"],
			["intel:finint", "supply_chain"],
			["intel:explorer", "markets"],
			["intel:explorer", "cyber"],
		] as const) {
			fixture(page([signal(1, domain)]));
			const result = success(
				await call("y2_list_signals_v2", { domain, priority: "high" }, [scope]),
			);
			assert.equal(result.items.length, 1);
			assert.equal(calls[1]?.searchParams.get("domain"), domain);
			assert.equal(calls[1]?.searchParams.get("priority"), "high");
		}
	});
	it("fails closed if a broad grant's backend response contains an unauthorized signal domain", async () => {
		fixture(page([signal(1, "cyber"), signal(2, "markets")]));
		const body = await call("y2_list_signals_v2", { domain: "cyber" }, [
			"intel:cyber",
		]);
		assert.equal(body.result?.isError, true);
		assert.equal(body.result?.structuredContent, undefined);
		assert.doesNotMatch(JSON.stringify(body), /Signal 2/);
	});
	it("retrieves report detail without confusing its nested profile with the report", async () => {
		fixture({
			data: {
				id: publicId("rpt"),
				topic: "Daily report",
				profile: { id: publicId("prf"), name: "Parent profile" },
				content: { markdown: "Evidence body" },
				sources: [{ url: "https://example.com/report-source" }],
			},
		});
		const result = success(
			await call("y2_get_report", { reportId: publicId("rpt") }),
		);
		assert.equal(result.items[0]?.id, publicId("rpt"));
		assert.equal(result.items[0]?.content, "Evidence body");
		assert.equal(calls[1]?.searchParams.get("include"), "content,sources");
	});
	it("requests geographic events with coordinates and passes accepted category and severity values", async () => {
		fixture(
			page([
				{
					id: publicId("obs"),
					title: "Event",
					geometry: { type: "Point", coordinates: [0, 0] },
					severity: "medium",
				},
			]),
		);
		const result = success(
			await call("y2_query_map", {
				countryCode: "US",
				severity: "medium",
				category: "economic",
				datetime: "2026-10-01T00:00:00Z/2026-10-05T00:00:00Z",
			}),
		);
		assert.deepEqual(result.items[0]?.coordinates, [0, 0]);
		assert.equal(calls[1]?.searchParams.get("requireCoordinates"), "true");
		assert.equal(calls[1]?.searchParams.get("severity"), "medium");
		assert.equal(calls[1]?.searchParams.get("category"), "economic");
	});
	it("rejects wrong ID types, invalid enum values, raw coordinates and oversized input", async () => {
		for (const [name, args] of [
			["y2_get_profile", { profileId: publicId("rpt") }],
			["y2_get_profile", { profileId: "internal_convex_id" }],
			["y2_list_signals_v2", { priority: "urgent" }],
			["y2_query_map", { severity: "moderate" }],
			["y2_query_map", { category: "secret_operation" }],
			["y2_query_map", { datetime: "yesterday" }],
			[
				"y2_query_map",
				{ datetime: "2026-10-05T00:00:00Z/2026-10-01T00:00:00Z" },
			],
			["y2_query_map", { datetime: "../.." }],
			["y2_query_map", { nearLat: 32, nearLon: -97 }],
			["y2_list_profiles", { q: "a".repeat(201) }],
			["y2_list_profiles", { limit: 51 }],
		] as const) {
			fixture(page([]));
			const response = await rpc("tools/call", { name, arguments: args });
			const body = (await response.json()) as {
				result?: { isError?: boolean };
				error?: unknown;
			};
			assert.ok(body.error || body.result?.isError, JSON.stringify(body));
			assert.equal(calls.length, 1);
		}
	});
	it("rejects reversed extraction-time bounds before fetching data", async () => {
		fixture(page([]));
		const body = await call("y2_list_signals_v2", { sinceMs: 2, untilMs: 1 });
		assert.equal(body.result?.isError, true);
		assert.equal(calls.length, 1);
	});
	it("pages an oversized API window without silently skipping records", async () => {
		fixture(
			page(
				Array.from({ length: 70 }, (_, index) => signal(index + 1)),
				"y2p1_next_source",
			),
		);
		const ids: string[] = [];
		let cursor: string | undefined;
		for (let index = 0; index < 4; index++) {
			const result = success(
				await call("y2_list_signals_v2", {
					domain: "cyber",
					limit: 20,
					...(cursor ? { cursor } : {}),
				}),
			);
			assert.ok(result.items.length <= 20);
			ids.push(...result.items.map((item) => item.id));
			cursor = result.nextCursor ?? undefined;
			assert.equal(result.hasMore, true);
		}
		assert.equal(ids.length, 70);
		assert.equal(new Set(ids).size, 70);
		assert.equal(cursor, "y2p1_next_source");
		assert.ok(
			calls
				.filter((url) => url.pathname === "/api/v2/signals")
				.every((url) => !url.searchParams.has("cursor")),
		);
	});
	it("binds native overflow cursors to filters and detects changed source windows", async () => {
		const rows = [signal(1), signal(2), signal(3)];
		fixture(page(rows));
		const first = success(
			await call("y2_list_signals_v2", { domain: "cyber", limit: 1 }),
		);
		assert.ok(first.nextCursor?.startsWith("y2m1_"));
		const changedFilter = await call("y2_list_signals_v2", {
			domain: "cyber",
			q: "new filter",
			cursor: first.nextCursor,
		});
		assert.equal(changedFilter.result?.isError, true);
		fixture(page([...rows].reverse()));
		const changedPage = await call("y2_list_signals_v2", {
			domain: "cyber",
			cursor: first.nextCursor,
		});
		assert.equal(changedPage.result?.isError, true);
		assert.match(JSON.stringify(changedPage), /results changed/);
	});
	it("adapts to the structured output byte budget while retaining all records through cursors", async () => {
		fixture(
			page(
				Array.from({ length: 30 }, (_, index) => ({
					id: publicId("prf", index + 1),
					name: `Profile ${index}`,
					topic: "Long topic ".repeat(280),
				})),
			),
		);
		const ids: string[] = [];
		let cursor: string | undefined;
		for (let index = 0; index < 10; index++) {
			const body = await call("y2_list_profiles", {
				limit: 30,
				...(cursor ? { cursor } : {}),
			});
			const result = success(body);
			assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 65_536);
			assert.ok(Buffer.byteLength(JSON.stringify(body.result)) <= 262_144);
			ids.push(...result.items.map((item) => item.id));
			cursor = result.nextCursor ?? undefined;
			if (!result.hasMore) break;
		}
		assert.equal(ids.length, 30);
		assert.equal(new Set(ids).size, 30);
	});
	it("fails safely for malformed, oversized and redirected API responses", async () => {
		for (const response of [
			new Response("{invalid", {
				headers: { "Content-Type": "application/json" },
			}),
			new Response("a".repeat(1_048_577)),
			new Response(null, {
				status: 302,
				headers: { Location: "https://evil.test/" },
			}),
		]) {
			fixture(response);
			const body = await call("y2_list_profiles");
			assert.equal(body.result?.isError, true);
			assert.equal(body.result?.structuredContent, undefined);
			assert.equal(calls.length, 2);
		}
	});
	it("renders profile status and a sourced latest report only when that permission is effective", async () => {
		const profile = {
			id: publicId("prf"),
			name: "Profile",
			topic: "Energy",
			status: "paused",
			frequency: "daily",
			tags: ["energy"],
			customInstructions: "private_prompt",
		};
		const report = {
			id: publicId("rpt"),
			topic: "Latest report",
			publishedAt: "2026-10-05T10:00:00Z",
			sources: [{ url: "https://example.com/evidence" }],
		};
		fixture((url: URL) =>
			url.pathname === `/api/v1/profiles/${profile.id}`
				? { data: profile }
				: url.pathname === "/api/v1/reports"
					? page([report])
					: { data: report },
		);
		const full = success(
			await call("y2_render_profile", { profileId: profile.id }),
		);
		assert.deepEqual(
			full.items.map((item) => item.kind),
			["profile", "report"],
		);
		assert.equal(full.items[0]?.status, "paused");
		assert.equal(full.items[0]?.frequency, "daily");
		assert.deepEqual(full.items[0]?.tags, ["energy"]);
		assert.equal(
			full.items[1]?.sources[0]?.url,
			"https://example.com/evidence",
		);
		assert.doesNotMatch(JSON.stringify(full), /private_prompt/);
		assert.equal(calls.length, 4);
		fixture({ data: profile });
		const narrow = success(
			await call("y2_render_profile", { profileId: profile.id }, [
				"profiles:read",
			]),
		);
		assert.equal(narrow.items.length, 1);
		assert.match(narrow.notice, /reports permission/);
		assert.equal(calls.length, 2);
	});
	it("keeps an authorized profile visible when its latest report is unavailable", async () => {
		fixture((url: URL) =>
			url.pathname.startsWith("/api/v1/profiles/")
				? { data: { id: publicId("prf"), name: "Profile" } }
				: new Response(null, { status: 503 }),
		);
		const result = success(
			await call("y2_render_profile", { profileId: publicId("prf") }),
		);
		assert.equal(result.items.length, 1);
		assert.match(result.notice, /latest report is temporarily unavailable/);
	});
});
