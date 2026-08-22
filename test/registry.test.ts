import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function readJson(path: string): Promise<Record<string, unknown>> {
	const text = await readFile(new URL(path, import.meta.url), "utf8");
	return JSON.parse(text) as Record<string, unknown>;
}

describe("registry metadata", () => {
	it("keeps server.json aligned with package metadata", async () => {
		const [serverJson, packageJson] = await Promise.all([
			readJson("../server.json"),
			readJson("../package.json"),
		]);
		const packages = serverJson.packages as Array<Record<string, unknown>>;
		const npmPackage = packages.find((entry) => entry.registryType === "npm");

		assert.equal(serverJson.name, packageJson.mcpName);
		assert.equal(serverJson.version, packageJson.version);
		assert.equal(npmPackage?.identifier, packageJson.name);
		assert.equal(npmPackage?.version, packageJson.version);
	});

	it("declares Y2_API_KEY as optional secret environment metadata", async () => {
		const serverJson = await readJson("../server.json");
		const packages = serverJson.packages as Array<Record<string, unknown>>;
		const npmPackage = packages.find((entry) => entry.registryType === "npm");
		const envVars = npmPackage?.environmentVariables as Array<Record<string, unknown>>;
		const apiKey = envVars.find((entry) => entry.name === "Y2_API_KEY");
		const writeTools = envVars.find((entry) => entry.name === "Y2_MCP_ENABLE_WRITE_TOOLS");

		assert.equal(apiKey?.isRequired, false);
		assert.equal(apiKey?.isSecret, true);
		assert.equal(apiKey?.format, "string");
		assert.equal(writeTools?.isRequired, false);
		assert.equal(writeTools?.format, "boolean");
		assert.equal(writeTools?.default, "false");
	});
});
