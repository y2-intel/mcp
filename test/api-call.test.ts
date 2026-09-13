import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parse } from "yaml";
import { loadConfig } from "../src/config.js";
import {
	buildRequestFromInput,
	candidatePaths,
	findOperationById,
	loadOpenApi,
} from "../src/openapi.js";
import { createServer } from "../src/server.js";
import { Y2Client } from "../src/y2-client.js";

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
  /projects:
    post:
      operationId: createProject
      requestBody:
        $ref: '#/components/requestBodies/ProjectWrite'
  /projects/{projectId}:
    parameters:
      - name: projectId
        in: path
        required: true
        schema:
          type: string
      - name: If-Match
        in: header
        required: true
        schema:
          type: string
    patch:
      operationId: patchProject
      parameters:
        - name: If-Match
          in: header
          required: false
          schema:
            type: string
      requestBody:
        $ref: '#/components/requestBodies/ProjectWrite'
  /automations/{automationId}/runs:
    post:
      operationId: runAutomation
      parameters:
        - name: automationId
          in: path
          required: true
          schema:
            type: string
        - name: Idempotency-Key
          in: header
          required: true
          schema:
            type: string
  /api/v2/intel/knowledge/retrieve:
    post:
      operationId: retrieveGlobalKnowledgeV2
      x-required-scopes: [intel:knowledge]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [query]
              properties:
                query:
                  type: string
  /agent-y2/chat/stream:
    post:
      operationId: streamAgentY2Chat
      x-required-scopes: [agent:y2]
  /chat/completions:
    post:
      operationId: createY2OpenAIChatCompletion
      x-required-scopes: [agent:y2]
  /x402/receipts/{nonce}:
    get:
      operationId: getX402Receipt
      security: []
      parameters:
        - name: nonce
          in: path
          required: true
          schema:
            type: string
  /paid:
    get:
      operationId: getPaidData
      security:
        - bearerAuth: []
        - {}
security:
  - bearerAuth: []
components:
  requestBodies:
    ProjectWrite:
      required: true
      description: Project creation fields.
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Project'
  schemas:
    Project:
      type: object
      required: [name]
      properties:
        name:
          $ref: '#/components/schemas/Name'
    Name:
      type: string
      minLength: 1
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

	it("resolves request body references and nested schemas for operation inspection", () => {
		const operation = findOperationById(parse(minimalSpec), "createProject");
		assert.equal(operation?.requestBodyRequired, true);
		assert.equal(operation?.requestBodyDescription, "Project creation fields.");
		assert.deepEqual(operation?.requestBodySchema, {
			type: "object", required: ["name"], properties: { name: { type: "string", minLength: 1 } },
		});
	});

	it("lets operation parameters override inherited path parameters", () => {
		const operation = findOperationById(parse(minimalSpec), "patchProject")!;
		assert.equal(operation.parameters.length, 2);
		assert.equal(operation.parameters.find((parameter) => parameter.name === "If-Match")?.required, false);
		assert.equal(buildRequestFromInput(operation, { projectId: "project-1" }).path, "/projects/project-1");
	});

	it("keeps recursive schema references bounded while resolving surrounding fields", () => {
		const spec = parse(minimalSpec);
		spec.components.schemas.Project.properties.parent = { $ref: "#/components/schemas/Project" };
		const operation = findOperationById(spec, "createProject")!;
		assert.deepEqual(operation.requestBodySchema?.properties?.parent, { $ref: "#/components/schemas/Project" });
		assert.ok(JSON.stringify(operation).length < 2_000);
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

	it("blocks write operations by ID and path unless write tools are enabled", async () => {
		const requests = stubApiFetch();
		await withClient({ Y2_API_KEY: "y2_test" }, async (client) => {
			for (const args of [{ operationId: "createProject" }, { path: "/api/v1/projects", method: "post" }]) {
				const result = await client.callTool({ name: "y2_call_api", arguments: { ...args, body: { name: "Demo" } } });
				assert.equal(result.isError, true);
				assert.match(JSON.stringify(result.content), /Y2_MCP_ENABLE_WRITE_TOOLS=1/);
			}
		});
		assert.equal(requests.length, 0);
	});

	it("requires the Agent Y2 opt-in independently of write tools for both chat endpoints", async () => {
		const requests = stubApiFetch();
		await withClient({ Y2_API_KEY: "y2_test", Y2_MCP_ENABLE_WRITE_TOOLS: "1" }, async (client) => {
			for (const operationId of ["streamAgentY2Chat", "createY2OpenAIChatCompletion"]) {
				const result = await client.callTool({ name: "y2_call_api", arguments: { operationId, body: { messages: [] } } });
				assert.equal(result.isError, true);
				assert.match(JSON.stringify(result.content), /Y2_MCP_ENABLE_AGENT=1/);
			}
		});
		assert.equal(requests.length, 0);
	});

	it("allows opted-in chat operations without enabling unrelated writes", async () => {
		const requests = stubApiFetch();
		await withClient({ Y2_API_KEY: "y2_test", Y2_MCP_ENABLE_AGENT: "1" }, async (client) => {
			const result = await client.callTool({ name: "y2_call_api", arguments: { operationId: "createY2OpenAIChatCompletion", body: { messages: [], stream: true } } });
			assert.equal(result.isError, undefined);
			assert.equal(new URL(requests[0].url).pathname, "/api/v1/chat/completions");
		});
	});

	it("keeps knowledge retrieval available without a write opt-in", async () => {
		const requests = stubApiFetch();
		await withClient({ Y2_API_KEY: "y2_test" }, async (client) => {
			const result = await client.callTool({ name: "y2_call_api", arguments: { operationId: "retrieveGlobalKnowledgeV2", body: { query: "Supply chains" } } });
			assert.equal(result.isError, undefined);
			assert.equal(new URL(requests[0].url).pathname, "/api/v2/intel/knowledge/retrieve");
			assert.deepEqual(await requests[0].json(), { query: "Supply chains" });
		});
	});

	it("routes public receipts under v1 without an API key or authorization header", async () => {
		const requests = stubApiFetch();
		await withClient({}, async (client) => {
			const result = await client.callTool({ name: "y2_call_api", arguments: { operationId: "getX402Receipt", parameters: { nonce: "nonce /123" } } });
			assert.equal(result.isError, undefined);
			assert.equal(requests[0].url, "https://api.y2.dev/api/v1/x402/receipts/nonce%20%2F123");
			assert.equal(requests[0].headers.has("authorization"), false);
		});
	});

	it("does not treat paid x402 alternatives as public data", async () => {
		const requests = stubApiFetch();
		await withClient({}, async (client) => {
			const result = await client.callTool({ name: "y2_call_api", arguments: { operationId: "getPaidData" } });
			assert.equal(result.isError, true);
			assert.match(JSON.stringify(result.content), /Y2_API_KEY is required/);
		});
		assert.equal(requests.length, 0);
	});

	it("rejects missing required path parameters, headers, and request bodies before API requests", async () => {
		const requests = stubApiFetch();
		await withClient({ Y2_API_KEY: "y2_test", Y2_MCP_ENABLE_WRITE_TOOLS: "1" }, async (client) => {
			for (const [args, message] of [
				[{ operationId: "getReport" }, "Missing required path parameter: reportId"],
				[{ operationId: "runAutomation", parameters: { automationId: "atm-1" } }, "Missing required header parameter: Idempotency-Key"],
				[{ operationId: "createProject" }, "requires a JSON request body"],
			] as const) {
				const result = await client.callTool({ name: "y2_call_api", arguments: args });
				assert.equal(result.isError, true);
				assert.ok(JSON.stringify(result.content).includes(message));
			}
		});
		assert.equal(requests.length, 0);
	});

	it("forwards opted-in JSON writes and their conditional headers", async () => {
		const requests = stubApiFetch();
		await withClient({ Y2_API_KEY: "y2_test", Y2_MCP_ENABLE_WRITE_TOOLS: "1" }, async (client) => {
			const result = await client.callTool({ name: "y2_call_api", arguments: {
				operationId: "patchProject", parameters: { projectId: "prj-1", "If-Match": '"v2"' }, body: { name: "Demo" },
			} });
			assert.equal(result.isError, undefined);
			assert.equal(requests[0].method, "PATCH");
			assert.equal(requests[0].headers.get("if-match"), '"v2"');
			assert.deepEqual(await requests[0].json(), { name: "Demo" });
		});
	});

	it("advertises the generic caller as action-capable when either opt-in is enabled", async () => {
		for (const env of [{ Y2_MCP_ENABLE_WRITE_TOOLS: "1" }, { Y2_MCP_ENABLE_AGENT: "1" }]) {
			await withClient(env, async (client) => {
				const { tools } = await client.listTools();
				const tool = tools.find((tool) => tool.name === "y2_call_api")!;
				assert.equal(tool.annotations?.readOnlyHint, false);
				assert.equal(tool.annotations?.destructiveHint, true);
			});
		}
	});

	it("rejects invalid documents without poisoning the spec cache", async () => {
		let calls = 0;
		globalThis.fetch = async () => new Response(++calls === 1 ? "<html>Unavailable</html>" : minimalSpec);
		const client = new Y2Client(loadConfig({}));
		await assert.rejects(loadOpenApi(client), /OpenAPI 3 paths/);
		const spec = await loadOpenApi(client);
		assert.ok(findOperationById(spec, "listReports"));
		await loadOpenApi(client);
		assert.equal(calls, 2);
	});
});

function stubApiFetch(): Request[] {
	const requests: Request[] = [];
	globalThis.fetch = async (input, init) => {
		if (String(input).includes("/api/openapi.yaml")) return new Response(minimalSpec);
		requests.push(new Request(input, init));
		return jsonResponse({ ok: true });
	};
	return requests;
}
