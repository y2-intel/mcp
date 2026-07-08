import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

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
	it("does not expose Agent Y2 by default", async () => {
		const tools = await listToolNames();
		assert.deepEqual(tools, [
			"y2_get_openapi_operation",
			"y2_get_report",
			"y2_list_news",
			"y2_list_reports",
		]);
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
});
