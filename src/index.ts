#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, redactKnownSecrets } from "./config.js";
import { createServer } from "./server.js";

async function main() {
	const config = loadConfig();
	const server = createServer(config);
	await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
	const config = loadConfig();
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${redactKnownSecrets(message, config)}\n`);
	process.exit(1);
});
