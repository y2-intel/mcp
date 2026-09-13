import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parse } from "yaml";
import { loadConfig } from "../src/config.js";
import { toResolvedOperation, type HttpMethod, type OpenApiDocument, type OpenApiSchema } from "../src/openapi.js";
import { createServer } from "../src/server.js";
import { Y2Client } from "../src/y2-client.js";

const methods = ["get", "post", "put", "patch", "delete"] as const;
const headerAliases: Record<string, string> = { "Idempotency-Key": "idempotencyKey", "If-Match": "ifMatch" };
const discoveryTools = new Set(["y2_call_api", "y2_list_api_operations", "y2_get_openapi_operation"]);

function sample(schema: OpenApiSchema): unknown {
	if (schema.enum?.length) return schema.enum[0];
	if (schema.default !== undefined) return schema.default;
	const type = Array.isArray(schema.type) ? schema.type.find((type) => type !== "null") : schema.type;
	switch (type) {
		case "object": return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([name, value]) => [name, sample(value)]));
		case "array": return [sample(schema.items ?? { type: "string" })];
		case "boolean": return true;
		case "number":
		case "integer": return Math.max(schema.minimum ?? 1, (schema.exclusiveMinimum ?? 0) + 1);
		default: return "contract-check".padEnd(schema.minLength ?? 0, "x").slice(0, schema.maxLength);
	}
}

function serialized(value: unknown): string {
	return Array.isArray(value) ? value.map(String).join(",") : String(value);
}

function apiPath(path: string): string {
	// Expected public contract: v1 paths are relative; v2 paths include /api/v2.
	return path.startsWith("/api/") ? path : `/api/v1${path}`;
}

function matchesPath(template: string, pathname: string): boolean {
	const pattern = template.split(/(\{[^}]+\})/).map((part) =>
		part.startsWith("{") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
	).join("");
	return new RegExp(`^${pattern}$`).test(pathname);
}

async function main() {
	const localPath = process.argv[2];
	const source = localPath ?? "https://y2.dev/api/openapi.yaml";
	// Fetch only the public document. Every API request below is intercepted.
	const raw = localPath
		? await readFile(localPath, "utf8")
		: await new Y2Client(loadConfig({})).fetchDocsText("/api/openapi.yaml");
	const spec = parse(raw) as OpenApiDocument;
	assert.ok(spec.openapi?.startsWith("3.") && spec.paths, "Expected an OpenAPI 3 document with paths");
	const operations = Object.entries(spec.paths).flatMap(([path, item]) => {
		const found = Object.keys(item).filter((key) => /^(get|post|put|patch|delete|head|options|trace)$/.test(key));
		for (const method of found) assert.ok(methods.includes(method as HttpMethod), `Unsupported method: ${method} ${path}`);
		return found.map((method) => toResolvedOperation(spec, path, method as HttpMethod));
	});
	assert.ok(operations.length > 0, "Expected published operations");
	const ids = operations.map((operation) => operation.operationId);
	assert.ok(ids.every(Boolean), "Every published operation must have an operationId");
	assert.equal(new Set(ids).size, ids.length, "Operation IDs must be unique");

	const originalFetch = globalThis.fetch;
	const requests: Request[] = [];
	globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		if (request.url === "https://docs.example.test/api/openapi.yaml") return new Response(raw);
		assert.equal(new URL(request.url).origin, "https://api.example.test", "Unexpected API destination");
		requests.push(request);
		return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
	};
	const server = createServer(loadConfig({
		Y2_API_KEY: "y2_contract_test",
		Y2_API_BASE_URL: "https://api.example.test",
		Y2_DOCS_BASE_URL: "https://docs.example.test",
		Y2_MCP_ENABLE_AGENT: "1",
		Y2_MCP_ENABLE_WRITE_TOOLS: "1",
		Y2_MCP_MAX_RESPONSE_CHARS: "200000",
	}));
	const client = new Client({ name: "y2-openapi-check", version: "0.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	try {
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		const call = async (name: string, args: Record<string, unknown>) => {
			requests.length = 0;
			const result = await client.callTool({ name, arguments: args });
			assert.ok(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
			return result.content as Array<{ type: string; text: string }>;
		};
		const listed = JSON.parse((await call("y2_list_api_operations", {}))[0].text) as Array<{ operationId: string }>;
		assert.deepEqual(listed.map((operation) => operation.operationId).sort(), [...ids].sort());
		for (const operation of operations) {
			assert.ok(operation.operationId);
			const inspected = JSON.parse((await call("y2_get_openapi_operation", { operationId: operation.operationId }))[0].text);
			assert.equal(inspected.path, operation.path);
			if (operation.hasRequestBody) {
				assert.ok(inspected.requestBodySchema, `${operation.operationId}: missing request body schema`);
				assert.ok(!inspected.requestBodySchema.$ref, `${operation.operationId}: unresolved request body`);
			}
			const parameters = Object.fromEntries(operation.parameters.map((parameter) => [parameter.name, sample(parameter.schema)]));
			await call("y2_call_api", { operationId: operation.operationId, parameters, ...(operation.hasRequestBody ? { body: {} } : {}) });
			assert.equal(requests.length, 1, operation.operationId);
			const request = requests[0];
			const expectedPath = apiPath(operation.path).replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(serialized(parameters[name])));
			assert.equal(new URL(request.url).pathname, expectedPath, operation.operationId);
			assert.equal(request.method, operation.method.toUpperCase(), operation.operationId);
			assert.equal(request.headers.has("authorization"), operation.requiresApiKey, operation.operationId);
			for (const parameter of operation.parameters) {
				if (parameter.in === "query") assert.equal(new URL(request.url).searchParams.get(parameter.name), serialized(parameters[parameter.name]), `${operation.operationId}: ${parameter.name}`);
				if (parameter.in === "header") assert.equal(request.headers.get(parameter.name), serialized(parameters[parameter.name]), `${operation.operationId}: ${parameter.name}`);
			}
			if (operation.hasRequestBody) assert.deepEqual(await request.json(), {}, operation.operationId);
		}

		const { tools } = await client.listTools();
		const typedTools = tools.filter((tool) => !discoveryTools.has(tool.name));
		const covered = new Set<string>();
		for (const tool of typedTools) {
			const properties = tool.inputSchema.properties as Record<string, OpenApiSchema>;
			const args = Object.fromEntries(Object.entries(properties ?? {}).map(([name, schema]) => [name, sample(schema)]));
			await call(tool.name, args);
			assert.equal(requests.length, 1, tool.name);
			const request = requests[0];
			const url = new URL(request.url);
			const operation = operations.find((operation) => request.method === operation.method.toUpperCase() && matchesPath(apiPath(operation.path), url.pathname));
			assert.ok(operation, `${tool.name}: no published operation matches ${request.method} ${url.pathname}`);
			covered.add(operation.operationId!);
			assert.equal(request.headers.has("authorization"), operation.requiresApiKey, tool.name);
			for (const scope of operation.requiredScopes) assert.ok(tool.description?.includes(scope), `${tool.name}: missing scope ${scope}`);
			for (const parameter of operation.parameters) {
				const name = parameter.in === "header" ? headerAliases[parameter.name] ?? parameter.name : parameter.name;
				const input = properties?.[name];
				assert.ok(input, `${tool.name}: missing ${parameter.in} parameter ${parameter.name}`);
				if (parameter.required) assert.ok(tool.inputSchema.required?.includes(name), `${tool.name}: ${name} must be required`);
				if (parameter.schema.enum) assert.deepEqual([...input.enum ?? []].sort(), [...parameter.schema.enum].sort(), `${tool.name}: ${name} enum differs`);
				if (typeof parameter.schema.maximum === "number") assert.ok(typeof input.maximum === "number" && input.maximum <= parameter.schema.maximum, `${tool.name}: ${name} exceeds API maximum`);
				if (typeof parameter.schema.minimum === "number") assert.ok(typeof input.minimum === "number" && input.minimum >= parameter.schema.minimum, `${tool.name}: ${name} is below API minimum`);
				if (typeof parameter.schema.exclusiveMinimum === "number") {
					assert.ok(typeof input.exclusiveMinimum === "number" && input.exclusiveMinimum >= parameter.schema.exclusiveMinimum, `${tool.name}: ${name} must exceed the API minimum`);
				}
				if (parameter.in === "path") assert.ok(url.pathname.includes(encodeURIComponent(serialized(args[name]))), `${tool.name}: ${name} was not forwarded`);
				if (parameter.in === "query") assert.equal(url.searchParams.get(parameter.name), serialized(args[name]), `${tool.name}: ${name} was not forwarded`);
				if (parameter.in === "header") assert.equal(request.headers.get(parameter.name), serialized(args[name]), `${tool.name}: ${name} was not forwarded`);
			}
			if (operation.requestBodyRequired) assert.ok(await request.text(), `${tool.name}: missing JSON body`);
		}
		assert.deepEqual([...covered].sort(), [...ids].sort(), "Typed tools must cover every published operation");
		console.log(`OpenAPI check passed: ${Object.keys(spec.paths).length} paths, ${operations.length} operations, ${typedTools.length} typed tools.`);
		console.log(`Source: ${source}. Discovery, routing, auth, scopes, parameters, enums, and numeric bounds checked; API calls were mocked.`);
	} finally {
		await Promise.allSettled([client.close(), server.close()]);
		globalThis.fetch = originalFetch;
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
