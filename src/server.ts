import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Y2McpConfig } from "./config.js";
import { registerDocsResources } from "./resources/docs.js";
import { registerAgentTools } from "./tools/ask-agent.js";
import { registerNewsTools } from "./tools/news.js";
import { registerOpenApiTools } from "./tools/openapi.js";
import { registerPrompts } from "./tools/prompts.js";
import { registerReportTools } from "./tools/reports.js";
import { Y2Client } from "./y2-client.js";

const VERSION = "0.1.0";

export function createServer(config: Y2McpConfig): McpServer {
	const server = new McpServer({
		name: "y2-mcp",
		version: VERSION,
	});
	const client = new Y2Client(config);

	registerDocsResources(server, client);
	if (config.enableAgentTool) {
		registerAgentTools(server, client, config);
	}
	registerReportTools(server, client, config);
	registerNewsTools(server, client, config);
	registerOpenApiTools(server, client, config);
	registerPrompts(server);

	return server;
}
