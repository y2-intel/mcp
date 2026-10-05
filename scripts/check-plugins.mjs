import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const json = async file => JSON.parse(await readFile(file, "utf8"));
const validator = new Ajv2020({ strict: true, allErrors: true });
for (const name of ["plugin", "mcp"]) {
	const validate = validator.compile(await json(`test/fixtures/plugin-schemas/${name}.json`));
	assert.ok(validate(await json(`plugins/openai/${name}.json`)), JSON.stringify(validate.errors));
}
const manifest = await json("plugins/openai/plugin.json");
const listing = manifest.extensions["com.openai"].interface;
assert.equal(listing.displayName, "Y2 Intel");
assert.ok(listing.shortDescription.length <= 30);
assert.ok(listing.longDescription.length <= 4000);
assert.ok(listing.defaultPrompt.length <= 3 && listing.defaultPrompt.every(prompt => prompt.length <= 128));
for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) assert.equal(new URL(listing[key]).protocol, "https:");
const review = manifest.extensions["com.openai"].review;
assert.ok(review.test_cases.positive.length >= 5 && review.test_cases.negative.length >= 3);
assert.equal(review.commerce, false);
const endpoint = "https://y2-intel-mcp.managed-services.workers.dev/mcp";
for (const [kind, file] of [["openai", "mcp.json"], ["claude", ".mcp.json"]]) {
	const config = await json(`plugins/${kind}/${file}`);
	assert.equal(Object.keys(config.mcpServers).length, 1);
	assert.equal(config.mcpServers["y2-intel"].url, endpoint);
	assert.equal(config.mcpServers["y2-intel"].headers, undefined);
	assert.ok((await readFile(`plugins/${kind}/README.md`, "utf8")).split(/\s+/).length >= 40);
	assert.ok((await stat(`plugins/${kind}/LICENSE`)).size > 0);
	const png = await readFile(`plugins/${kind}/assets/logo.png`);
	assert.equal(png.subarray(1, 4).toString(), "PNG");
	assert.ok(png.readUInt32BE(16) >= 48 && png.readUInt32BE(16) <= 4096);
	assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
	for (const entry of await readdir(`plugins/${kind}`, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const full = path.join(entry.parentPath, entry.name);
		assert.ok((await stat(full)).size < 5 * 1024 * 1024);
		if (!entry.name.endsWith(".png")) {
			const content = await readFile(full, "utf8");
			assert.ok(!/y2_[a-f0-9]{64}|sk-[A-Za-z0-9]{24,}|BEGIN PRIVATE KEY/.test(content), `Credential found: ${full}`);
		}
	}
}
assert.equal((await json("plugins/claude/.claude-plugin/plugin.json")).version, manifest.version);
console.log("Validated both plugin bundles, metadata, remote configuration, assets, review cases, and credential exclusions.");
