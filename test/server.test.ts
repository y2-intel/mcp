import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

async function listToolNames(env: Record<string, string | undefined> = {}) {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "y2-mcp-test", version: "0.0.0" });
	const server = createServer(loadConfig(env));
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	try {
		const { tools } = await client.listTools();
		return tools.map((tool) => tool.name).sort();
	} finally {
		await Promise.allSettled([server.close(), client.close()]);
	}
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
});
