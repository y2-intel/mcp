import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import {
	buildRequestFromInput,
	candidatePaths,
	findOperationById,
} from "../src/openapi.js";
import { createServer } from "../src/server.js";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(body), {
		...init,
		headers: { "content-type": "application/json", ...(init.headers ?? {}) },
	});
}

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

const minimalSpec = `
openapi: 3.1.0
paths:
  /reports:
    get:
      operationId: listReports
      summary: List reports
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
  /reports/{reportId}:
    get:
      operationId: getReport
      summary: Get report
      parameters:
        - name: reportId
          in: path
          required: true
          schema:
            type: string
        - name: include
          in: query
          description: Comma-separated expansions.
          schema:
            type: string
        - name: X-Trace
          in: header
          schema:
            type: string
`;

function stubSpecFetch() {
	globalThis.fetch = (async () =>
		new Response(minimalSpec, {
			headers: { "content-type": "application/yaml" },
		})) as typeof fetch;
}

describe("openapi helpers", () => {
	it("builds path, query, and headers from resolved operations", () => {
		const operation = {
			path: "/reports/{reportId}",
			method: "get" as const,
			parameters: [
				{ name: "reportId", in: "path", required: true, description: undefined, schema: {} },
				{ name: "include", in: "query", required: false, description: undefined, schema: {} },
				{ name: "X-Trace", in: "header", required: false, description: undefined, schema: {} },
			],
		};
		const built = buildRequestFromInput(operation as never, {
			reportId: "rpt abc",
			include: ["content", "sources"],
			"X-Trace": "trace-1",
			limit: 5,
		});

		assert.equal(built.path, "/reports/rpt%20abc");
		assert.deepEqual(built.query, { include: "content,sources" });
		assert.equal(built.headers["x-trace"], "trace-1");
	});

	it("finds operations by id in a parsed spec", () => {
		const parsed = findOperationById(
			{
				paths: {
					"/reports/{reportId}": {
						get: { operationId: "getReport" },
					},
				},
			} as never,
			"getReport",
		);
		assert.equal(parsed?.path, "/reports/{reportId}");
		assert.equal(parsed?.method, "get");
	});
});

describe("spec-driven api call tools", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("exposes y2_list_api_operations and y2_call_api by default", async () => {
		await withClient({}, async (client) => {
			const { tools } = await client.listTools();
			assert.ok(tools.find((tool) => tool.name === "y2_list_api_operations"));
			assert.ok(tools.find((tool) => tool.name === "y2_call_api"));
		});
	});

	it("lists operations from the published spec without an API key", async () => {
		stubSpecFetch();
		await withClient({ Y2_DOCS_BASE_URL: "https://docs.example.com" }, async (client) => {
			const result = await client.callTool({ name: "y2_list_api_operations", arguments: {} });
			assert.equal(result.isError, undefined);
			const text = JSON.stringify(result.content);
			assert.ok(text.includes("listReports"));
			assert.ok(text.includes("getReport"));
		});
	});

	it("calls an operation by operationId with query building", async () => {
		stubSpecFetch();
		const requests: Request[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes("/api/openapi.yaml")) {
				return new Response(minimalSpec, { headers: { "content-type": "application/yaml" } });
			}
			requests.push(new Request(input, init));
			return jsonResponse({ ok: true });
		}) as typeof fetch;

		await withClient(
			{ Y2_API_KEY: "y2_test", Y2_API_BASE_URL: "https://api.example.com" },
			async (client) => {
				const result = await client.callTool({
					name: "y2_call_api",
					arguments: { operationId: "listReports", parameters: { limit: 5 } },
				});

				assert.equal(result.isError, undefined);
				assert.equal(requests[0].url, "https://api.example.com/api/v1/reports?limit=5");
				assert.equal(requests[0].headers.get("authorization"), "Bearer y2_test");
			},
		);
	});

	it("rejects calls without operationId or path plus method", async () => {
		stubSpecFetch();
		await withClient({ Y2_API_KEY: "y2_test" }, async (client) => {
			const result = await client.callTool({ name: "y2_call_api", arguments: {} });
			assert.equal(result.isError, true);
			const text = JSON.stringify(result.content);
			assert.ok(text.includes("operationId or both path and method"));
		});
	});
});
