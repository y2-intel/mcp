import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { expandedReadToolNames, expandedWriteToolNames } from "../src/tools/api.js";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(body), {
		...init,
		headers: {
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
}

async function withClient<T>(
	env: Record<string, string | undefined>,
	fn: (client: Client) => Promise<T>,
): Promise<T> {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "y2-mcp-test", version: "0.0.0" });
	const server = createServer(loadConfig(env));
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	try {
		return await fn(client);
	} finally {
		await Promise.allSettled([server.close(), client.close()]);
	}
}

async function listToolNames(env: Record<string, string | undefined> = {}) {
	return await withClient(env, async (client) => {
		const { tools } = await client.listTools();
		return tools.map((tool) => tool.name).sort();
	});
}

describe("createServer", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("does not expose Agent Y2 by default", async () => {
		const tools = await listToolNames();
		for (const toolName of [
			"y2_get_openapi_operation",
			"y2_get_report",
			"y2_list_news",
			"y2_list_reports",
			...expandedReadToolNames,
		]) {
			assert.ok(tools.includes(toolName), toolName);
		}
		assert.equal(tools.includes("y2_ask_agent"), false);
		assert.equal(tools.includes("y2_create_chat_completion"), false);
		for (const toolName of expandedWriteToolNames) {
			assert.equal(tools.includes(toolName), false, toolName);
		}
	});

	it("exposes Agent Y2 only when explicitly enabled", async () => {
		const tools = await listToolNames({ Y2_MCP_ENABLE_AGENT: "1" });
		assert.ok(tools.includes("y2_ask_agent"));
		assert.ok(tools.includes("y2_create_chat_completion"));
	});

	it("advertises read-only hints for default external API tools", async () => {
		await withClient({}, async (client) => {
			const { tools } = await client.listTools();
			for (const tool of tools) {
				assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
				assert.equal(tool.annotations?.openWorldHint, true, tool.name);
				assert.ok(tool.title, tool.name);
			}
		});
	});

	it("advertises Agent Y2 as an opt-in action-capable tool", async () => {
		await withClient({ Y2_MCP_ENABLE_AGENT: "1" }, async (client) => {
			const { tools } = await client.listTools();
			const agentTool = tools.find((tool) => tool.name === "y2_ask_agent");
			assert.equal(agentTool?.annotations?.readOnlyHint, false);
			assert.equal(agentTool?.annotations?.destructiveHint, true);
			assert.equal(agentTool?.annotations?.idempotentHint, false);
			assert.equal(agentTool?.annotations?.openWorldHint, true);
			assert.equal(agentTool?.title, "Ask Agent Y2");
		});
	});

	it("exposes write tools only when explicitly enabled", async () => {
		const tools = await listToolNames({ Y2_MCP_ENABLE_WRITE_TOOLS: "1" });
		for (const toolName of expandedWriteToolNames) {
			assert.ok(tools.includes(toolName), toolName);
		}
	});

	it("advertises resource and prompt display metadata", async () => {
		await withClient({}, async (client) => {
			const [{ resources }, { prompts }] = await Promise.all([
				client.listResources(),
				client.listPrompts(),
			]);

			assert.ok(resources.find((resource) => resource.name === "y2-openapi")?.title);
			assert.ok(resources.find((resource) => resource.name === "y2-quickstart")?.description);
			assert.ok(prompts.find((prompt) => prompt.name === "integrate-y2-api")?.title);
			assert.ok(prompts.find((prompt) => prompt.name === "debug-y2-api-call")?.description);
		});
	});

	it("routes expanded v1 tools through the API v1 base with auth", async () => {
		const requests: Request[] = [];
		globalThis.fetch = async (input, init) => {
			requests.push(new Request(input, init));
			return jsonResponse({ ok: true });
		};

		await withClient(
			{ Y2_API_KEY: "y2_test", Y2_API_BASE_URL: "https://api.example.com" },
			async (client) => {
				const result = await client.callTool({
					name: "y2_get_country_predictions",
					arguments: { countryCode: "US", limit: 2 },
				});

				assert.equal(result.isError, undefined);
				assert.equal(requests[0].url, "https://api.example.com/api/v1/osint/countries/US/predictions?limit=2");
				assert.equal(requests[0].headers.get("authorization"), "Bearer y2_test");
			},
		);
	});

	it("routes expanded v2 tools through the API root with auth", async () => {
		const requests: Request[] = [];
		globalThis.fetch = async (input, init) => {
			requests.push(new Request(input, init));
			return jsonResponse({ ok: true });
		};

		await withClient(
			{ Y2_API_KEY: "y2_test", Y2_API_BASE_URL: "https://api.example.com" },
			async (client) => {
				await client.callTool({
					name: "y2_list_incidents_v2",
					arguments: { category: "cyber", limit: 3 },
				});

				assert.equal(requests[0].url, "https://api.example.com/api/v2/incidents?category=cyber&limit=3");
				assert.equal(requests[0].headers.get("authorization"), "Bearer y2_test");
			},
		);
	});

	it("allows public x402 receipt lookup without Y2_API_KEY", async () => {
		const requests: Request[] = [];
		globalThis.fetch = async (input, init) => {
			requests.push(new Request(input, init));
			return jsonResponse({ ok: true });
		};

		await withClient({ Y2_API_BASE_URL: "https://api.example.com" }, async (client) => {
			const result = await client.callTool({
				name: "y2_get_x402_receipt",
				arguments: { nonce: "nonce_123" },
			});

			assert.equal(result.isError, undefined);
			assert.equal(requests[0].url, "https://api.example.com/api/v1/x402/receipts/nonce_123");
			assert.equal(requests[0].headers.has("authorization"), false);
		});
	});

	it("routes opt-in write tools with JSON body and write annotations", async () => {
		const requests: Request[] = [];
		globalThis.fetch = async (input, init) => {
			requests.push(new Request(input, init));
			return jsonResponse({ ok: true });
		};

		await withClient(
			{
				Y2_API_KEY: "y2_test",
				Y2_API_BASE_URL: "https://api.example.com",
				Y2_MCP_ENABLE_WRITE_TOOLS: "1",
			},
			async (client) => {
				const { tools } = await client.listTools();
				const patchProfile = tools.find((tool) => tool.name === "y2_patch_profile");
				assert.equal(patchProfile?.annotations?.readOnlyHint, false);
				assert.equal(patchProfile?.annotations?.destructiveHint, true);

				await client.callTool({
					name: "y2_patch_profile",
					arguments: { profileId: "profile_123", body: { status: "paused" } },
				});

				assert.equal(requests[0].url, "https://api.example.com/api/v1/profiles/profile_123");
				assert.equal(requests[0].method, "PATCH");
				assert.equal(requests[0].headers.get("authorization"), "Bearer y2_test");
				assert.deepEqual(await requests[0].json(), { status: "paused" });
			},
		);
	});

	it("does not execute ledger writes without the write opt-in", async () => {
		let requests = 0;
		globalThis.fetch = async () => {
			requests++;
			return jsonResponse({ ok: true });
		};
		await withClient({ Y2_API_KEY: "y2_test" }, async (client) => {
			for (const name of ["y2_open_ledger_subject_v2", "y2_append_ledger_record_v2"]) {
				const result = await client.callTool({ name, arguments: { body: {} } });
				assert.equal(result.isError, true, name);
			}
		});
		assert.equal(requests, 0);
	});

	it("forwards opted-in ledger subject and record bodies with retry keys", async () => {
		const requests: Request[] = [];
		globalThis.fetch = async (input, init) => {
			requests.push(new Request(input, init));
			return jsonResponse({ ok: true });
		};
		const cases = [
			{
				name: "y2_open_ledger_subject_v2",
				path: "/api/v2/ledger/subjects",
				body: { class: "organization", entityId: `ent_${"a".repeat(24)}` },
			},
			{
				name: "y2_append_ledger_record_v2",
				path: "/api/v2/ledger/records",
				body: {
					kind: "designator",
					designator: { kind: "ticker", value: "ACME", namespace: "NASDAQ" },
				},
			},
			{
				name: "y2_append_ledger_record_v2",
				path: "/api/v2/ledger/records",
				body: {
					kind: "observation",
					observation: {
						method: "public-registry",
						sourceGrade: "primary",
						collector: "review-test",
						retrievedAt: "2026-10-05T00:00:00Z",
						excerpt: "Synthetic public filing",
						sourceUrl: "https://example.test/filing",
					},
				},
			},
			{
				name: "y2_append_ledger_record_v2",
				path: "/api/v2/ledger/records",
				body: {
					kind: "claim",
					claim: {
						op: "assert",
						predicate: "designated-by",
						from: `sbj_${"a".repeat(24)}`,
						to: `dsg_${"b".repeat(24)}`,
						evidenceRefs: [`obv_${"c".repeat(24)}`],
						confidence: 80,
						verification: "located",
					},
				},
			},
		];
		await withClient(
			{
				Y2_API_KEY: "y2_test",
				Y2_MCP_ENABLE_WRITE_TOOLS: "1",
				Y2_API_BASE_URL: "https://api.example.com",
			},
			async (client) => {
				for (const [index, entry] of cases.entries()) {
					const idempotencyKey = `ledger-write-test-${index}`;
					const result = await client.callTool({
						name: entry.name,
						arguments: { body: entry.body, idempotencyKey },
					});
					assert.equal(result.isError, undefined, JSON.stringify(result.content));
					assert.equal(requests[index].url, `https://api.example.com${entry.path}`);
					assert.equal(requests[index].method, "POST");
					assert.equal(requests[index].headers.get("authorization"), "Bearer y2_test");
					assert.equal(requests[index].headers.get("Idempotency-Key"), idempotencyKey);
					assert.deepEqual(await requests[index].json(), entry.body);
				}
			},
		);
	});

	it("rejects invalid public IDs, bounds, and ledger bodies before making API requests", async () => {
		let requests = 0;
		globalThis.fetch = async () => {
			requests++;
			return jsonResponse({ ok: true });
		};
		const entityId = `ent_${"a".repeat(24)}`;
		const subjectId = `sbj_${"a".repeat(24)}`;
		const cases = [
			{ name: "y2_get_profile", args: { profileId: "internal-profile-id" } },
			{ name: "y2_list_profiles", args: { limit: 51 } },
			{
				name: "y2_list_company_financial_observations_v2",
				args: { entityId, factType: "forecast" },
			},
			{
				name: "y2_list_company_financial_observations_v2",
				args: { entityId, metricKey: "INVALID METRIC" },
			},
			{ name: "y2_get_entity_fusion_v2", args: { entityId, adjacencyDays: 91 } },
			{ name: "y2_get_ledger_subject_v2", args: { subjectId, recordedAt: "yesterday" } },
			{ name: "y2_get_ledger_subject_stix_v2", args: { subjectId, history: "false" } },
			{ name: "y2_verify_ledger_v2", args: { afterSeq: -1 } },
			{ name: "y2_list_ledger_records_v2", args: { limit: 201 } },
			{ name: "y2_open_ledger_subject_v2", args: { body: { class: "country" } } },
			{
				name: "y2_open_ledger_subject_v2",
				args: { body: { class: "person", workspaceId: "other-workspace" } },
			},
			{
				name: "y2_append_ledger_record_v2",
				args: {
					body: {
						kind: "observation",
						observation: {
							method: "authenticated-access",
							sourceGrade: "primary",
							collector: "test",
						},
					},
				},
			},
			{
				name: "y2_append_ledger_record_v2",
				args: {
					body: {
						kind: "claim",
						claim: { predicate: "same-as", from: subjectId, to: subjectId, evidenceRefs: [] },
					},
				},
			},
		];
		await withClient({ Y2_API_KEY: "y2_test", Y2_MCP_ENABLE_WRITE_TOOLS: "1" }, async (client) => {
			for (const entry of cases) {
				const result = await client.callTool({ name: entry.name, arguments: entry.args });
				assert.equal(result.isError, true, entry.name);
			}
		});
		assert.equal(requests, 0);
	});
	it("preserves Markdown, NDJSON, and streaming tool-call responses", async () => {
		const requests: Request[] = [];
		const cases = [
			{ name: "y2_get_report", args: { reportId: "rpt-1", format: "markdown", include: "content,sources", view: "agent" }, contentType: "text/markdown", text: "# Report\n\nFindings" },
			{ name: "y2_list_reports", args: { cursor: "next-reports", format: "ndjson" }, contentType: "application/x-ndjson", text: '{"id":1}\n{"id":2}\n' },
			{ name: "y2_list_news", args: { cursor: "next-news", format: "ndjson" }, contentType: "application/x-ndjson", text: '{"headline":"First"}\n{"headline":"Second"}\n' },
			{ name: "y2_create_chat_completion", args: { body: { messages: [{ role: "user", content: "Find reports" }], stream: true } }, contentType: "text/event-stream", text: 'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"find_reports"}}]}}]}\n\ndata: [DONE]\n\n' },
			{ name: "y2_list_news", args: { format: "ndjson" }, contentType: "application/x-ndjson", text: '{"headline":"Only one row"}\n' },
		] as const;
		await withClient({ Y2_API_KEY: "y2_test", Y2_MCP_ENABLE_AGENT: "1" }, async (client) => {
			for (const entry of cases) {
				globalThis.fetch = async (input, init) => {
					requests.push(new Request(input, init));
					return new Response(entry.text, { headers: { "content-type": entry.contentType } });
				};
				const result = await client.callTool({ name: entry.name, arguments: entry.args });
				assert.equal(result.isError, undefined, entry.name);
				assert.deepEqual(result.content, [{ type: "text", text: entry.text }], entry.name);
			}
		});
		assert.equal(new URL(requests[0].url).searchParams.get("include"), "content,sources");
		assert.equal(new URL(requests[0].url).searchParams.get("view"), "agent");
		assert.equal(new URL(requests[1].url).searchParams.get("cursor"), "next-reports");
		assert.equal(new URL(requests[2].url).searchParams.get("cursor"), "next-news");
		assert.equal(new URL(requests[3].url).pathname, "/api/v1/chat/completions");
		assert.deepEqual(await requests[3].json(), cases[3].args.body);
	});
});
