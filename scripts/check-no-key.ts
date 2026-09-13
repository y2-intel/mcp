import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const env = { ...process.env };
delete env.Y2_API_KEY;

const result = spawnSync("npx", [
	"@modelcontextprotocol/inspector", "--cli", "node", "dist/index.js",
	"--method", "tools/call", "--tool-name", "y2_list_reports", "--tool-arg", "limit=1",
], { env, encoding: "utf8", timeout: 60_000 });

if (result.error) throw result.error;
// Inspector versions differ: an isError result may exit successfully or use 5.
assert.ok(result.status === 0 || result.status === 5, result.stderr || `Inspector exited with ${result.status}`);
const output = CallToolResultSchema.parse(JSON.parse(result.stdout));
assert.equal(output.isError, true, "Expected a missing-key tool error");
assert.ok(output.content.some((item) =>
	item.type === "text" && item.text === "Y2_API_KEY is required for this tool.",
), "Expected the Y2_API_KEY error, not another tool failure");

process.stdout.write(result.stdout);
console.log("Verified the missing-key MCP error response.");
