import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig, redactSecret } from "../src/config.js";

describe("config", () => {
	it("loads defaults and trims base URLs", () => {
		const config = loadConfig({
			Y2_API_KEY: " y2_test ",
			Y2_API_BASE_URL: "https://api.example.com/",
			Y2_DOCS_BASE_URL: "https://docs.example.com/",
		});

		assert.equal(config.apiKey, "y2_test");
		assert.equal(config.apiBaseUrl, "https://api.example.com");
		assert.equal(config.docsBaseUrl, "https://docs.example.com");
	});

	it("bounds timeout values", () => {
		assert.equal(loadConfig({ Y2_MCP_TIMEOUT_MS: "5" }).timeoutMs, 1_000);
		assert.equal(loadConfig({ Y2_MCP_TIMEOUT_MS: "999999999" }).timeoutMs, 300_000);
	});

	it("keeps Agent Y2 tool disabled unless explicitly enabled", () => {
		assert.equal(loadConfig({}).enableAgentTool, false);
		assert.equal(loadConfig({ Y2_MCP_ENABLE_AGENT: "0" }).enableAgentTool, false);
		assert.equal(loadConfig({ Y2_MCP_ENABLE_AGENT: "1" }).enableAgentTool, true);
		assert.equal(loadConfig({ Y2_MCP_ENABLE_AGENT: "true" }).enableAgentTool, true);
	});

	it("redacts secrets", () => {
		assert.equal(redactSecret("y2_1234567890"), "y2_1...[redacted]...7890");
	});
});
