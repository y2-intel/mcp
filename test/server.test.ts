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
		for (const toolName of expandedWriteToolNames) {
			assert.equal(tools.includes(toolName), false, toolName);
		}
	});

	it("exposes Agent Y2 only when explicitly enabled", async () => {
		const tools = await listToolNames({ Y2_MCP_ENABLE_AGENT: "1" });
		assert.ok(tools.includes("y2_ask_agent"));
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
});
