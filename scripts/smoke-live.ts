import { loadConfig } from "../src/config.js";
import { Y2ApiError } from "../src/errors.js";
import { Y2Client } from "../src/y2-client.js";

const availableTools = new Set(["reports", "news", "agent"]);

function requestedTools(): string[] {
	const value = process.env.Y2_MCP_SMOKE_TOOLS ?? "reports,news";
	const tools = value
		.split(",")
		.map((tool) => tool.trim())
		.filter(Boolean);
	const invalid = tools.filter((tool) => !availableTools.has(tool));
	if (invalid.length > 0) {
		throw new Error(`Unknown smoke tool(s): ${invalid.join(", ")}`);
	}
	return [...new Set(tools)];
}

function summarizePayload(payload: unknown): string {
	if (Array.isArray(payload)) return `array(${payload.length})`;
	if (payload && typeof payload === "object") {
		return `object keys=${Object.keys(payload as Record<string, unknown>).slice(0, 8).join(",")}`;
	}
	return typeof payload;
}

async function runStep(name: string, fn: () => Promise<string>) {
	try {
		const result = await fn();
		console.log(`ok ${name}: ${result}`);
	} catch (error) {
		if (error instanceof Y2ApiError) {
			console.error(
				`not ok ${name}: status=${error.status} code=${error.code ?? "unknown"} message=${error.message}`,
			);
			process.exitCode = 1;
			return;
		}
		throw error;
	}
}

async function main() {
	const config = loadConfig();
	if (!config.apiKey) {
		throw new Error("Y2_API_KEY is required for live smoke tests.");
	}

	const client = new Y2Client(config);
	const tools = requestedTools();
	if (tools.includes("agent") && !config.enableAgentTool) {
		throw new Error("Set Y2_MCP_ENABLE_AGENT=1 before running the Agent Y2 smoke test.");
	}

	if (tools.includes("reports")) {
		await runStep("reports", async () => {
			const payload = await client.requestJson("/api/v1/reports", {
				query: { limit: "1" },
			});
			return summarizePayload(payload);
		});
	}

	if (tools.includes("news")) {
		await runStep("news", async () => {
			const payload = await client.requestJson("/api/v1/news", {
				query: { limit: "1" },
			});
			return summarizePayload(payload);
		});
	}

	if (tools.includes("agent")) {
		await runStep("agent", async () => {
			const response = await client.askAgent({
				message:
					"Y2 MCP release smoke test. Reply with one sentence confirming the connection works.",
				source: "y2_mcp_release_smoke",
			});
			return `status=${response.status} threadId=${response.threadId ?? "missing"} textChars=${response.text.length}`;
		});
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
