import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Y2Client } from "../y2-client.js";

export function registerDocsResources(server: McpServer, client: Y2Client) {
	server.registerResource(
		"y2-docs-index",
		"y2://docs/index",
		{
			title: "Y2 Docs Index",
			description: "Y2 documentation index for discovering relevant docs pages.",
			mimeType: "text/plain",
		},
		async (uri) => ({
			contents: [
				{
					uri: uri.href,
					mimeType: "text/plain",
					text: await client.fetchDocsText("/llms.txt"),
				},
			],
		}),
	);

	server.registerResource(
		"y2-docs-full",
		"y2://docs/full",
		{
			title: "Y2 Full Docs",
			description: "Full Y2 documentation text for agent context.",
			mimeType: "text/plain",
		},
		async (uri) => ({
			contents: [
				{
					uri: uri.href,
					mimeType: "text/plain",
					text: await client.fetchDocsText("/llms-full.txt"),
				},
			],
		}),
	);

	server.registerResource(
		"y2-openapi",
		"y2://openapi",
		{
			title: "Y2 OpenAPI",
			description: "Published Y2 OpenAPI document.",
			mimeType: "application/yaml",
		},
		async (uri) => ({
			contents: [
				{
					uri: uri.href,
					mimeType: "application/yaml",
					text: await client.fetchDocsText("/api/openapi.yaml"),
				},
			],
		}),
	);

	server.registerResource(
		"y2-quickstart",
		"y2://quickstart",
		{
			title: "Y2 Quickstart",
			description: "Compact Y2 API quickstart for AI agents.",
			mimeType: "text/plain",
		},
		async (uri) => ({
			contents: [
				{
					uri: uri.href,
					mimeType: "text/plain",
					text: [
						"Y2 API quickstart for AI agents:",
						"- Docs index: https://y2.dev/llms.txt",
						"- Full docs: https://y2.dev/llms-full.txt",
						"- OpenAPI: https://y2.dev/api/openapi.yaml",
						"- Core API root: https://api.y2.dev/api/v1",
						"- Intel API root: https://api.y2.dev/api/v2",
						"- Use Authorization: Bearer $Y2_API_KEY.",
						"- Keep Y2_API_KEY server-side or in local MCP environment only.",
						"- Request the narrowest scopes needed.",
						"- Use agent:y2 only when Agent Y2 account actions are intended.",
					].join("\n"),
				},
			],
		}),
	);
}
