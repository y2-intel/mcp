import { parse } from "yaml";
import type { Y2Client } from "./y2-client.js";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export type OpenApiParameter = {
	name?: string;
	in?: string;
	required?: boolean;
	description?: string;
	schema?: OpenApiSchema | { $ref: string };
	$ref?: string;
};

export type OpenApiSchema = {
	type?: string | string[];
	format?: string;
	description?: string;
	enum?: unknown[];
	pattern?: string;
	properties?: Record<string, OpenApiSchema>;
	required?: string[];
	allOf?: OpenApiSchema[];
	anyOf?: OpenApiSchema[];
	oneOf?: OpenApiSchema[];
	additionalProperties?: boolean | OpenApiSchema;
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: number;
	exclusiveMaximum?: number;
	minLength?: number;
	maxLength?: number;
	minItems?: number;
	maxItems?: number;
	default?: unknown;
	items?: OpenApiSchema;
	$ref?: string;
};

export type OpenApiDocument = {
	openapi?: string;
	security?: Array<Record<string, string[]>>;
	paths?: Record<string, Record<string, { operationId?: string; parameters?: OpenApiParameter[] } & Record<string, unknown>>>;
	components?: {
		schemas?: Record<string, OpenApiSchema>;
		parameters?: Record<string, OpenApiParameter>;
	};
};

export type ResolvedOperation = {
	path: string;
	method: HttpMethod;
	operationId: string | undefined;
	title: string | undefined;
	description: string | undefined;
	parameters: Array<{
		name: string;
		in: string;
		required: boolean;
		description: string | undefined;
		schema: OpenApiSchema;
	}>;
	hasRequestBody: boolean;
	requestBodyRequired: boolean;
	requestBodyDescription: string | undefined;
	requestBodySchema: OpenApiSchema | undefined;
	requiredScopes: string[];
	requiresApiKey: boolean;
};

const SPEC_PATH = "/api/openapi.yaml";
const SPEC_CACHE_TTL_MS = 10 * 60 * 1000;

const specCache = new WeakMap<Y2Client, { spec: OpenApiDocument; fetchedAt: number }>();

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function resolveRef(spec: OpenApiDocument, node: { $ref?: string }): unknown {
	const ref = node.$ref;
	if (!ref || !ref.startsWith("#/")) return undefined;
	let current: unknown = spec;
	for (const segment of ref.slice(2).split("/")) {
		current = asRecord(current)[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
	}
	return current;
}

function resolveParameter(spec: OpenApiDocument, parameter: OpenApiParameter): OpenApiParameter {
	if (!parameter.$ref) return parameter;
	return resolveRef(spec, parameter) as OpenApiParameter ?? parameter;
}

function resolveSchema(spec: OpenApiDocument, schema: OpenApiSchema | { $ref: string } | undefined): OpenApiSchema {
	function resolve(value: unknown, seen: Set<string>): unknown {
		if (Array.isArray(value)) return value.map((entry) => resolve(entry, seen));
		if (!value || typeof value !== "object") return value;
		const node = asRecord(value);
		if (typeof node.$ref === "string" && !seen.has(node.$ref)) {
			const target = resolveRef(spec, { $ref: node.$ref });
			if (target) {
				const { $ref, ...siblings } = node;
				return resolve({ ...asRecord(target), ...siblings }, new Set([...seen, $ref]));
			}
		}
		return Object.fromEntries(Object.entries(node).map(([key, entry]) => [key, resolve(entry, seen)]));
	}
	return resolve(schema ?? {}, new Set()) as OpenApiSchema;
}

export async function loadOpenApi(client: Y2Client, options: { forceRefresh?: boolean } = {}): Promise<OpenApiDocument> {
	const cached = specCache.get(client);
	if (!options.forceRefresh && cached && Date.now() - cached.fetchedAt < SPEC_CACHE_TTL_MS) {
		return cached.spec;
	}
	const text = await client.fetchDocsText(SPEC_PATH);
	const spec = parse(text) as OpenApiDocument;
	if (!spec?.openapi?.startsWith("3.") || !spec.paths || typeof spec.paths !== "object" || Array.isArray(spec.paths)) {
		throw new Error("The Y2 OpenAPI document must contain OpenAPI 3 paths.");
	}
	specCache.set(client, { spec, fetchedAt: Date.now() });
	return spec;
}

const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete"];

function resolveOperationParameters(spec: OpenApiDocument, pathItem: Record<string, unknown>, operation: Record<string, unknown>): OpenApiParameter[] {
	const merged = [
		...((pathItem.parameters as OpenApiParameter[] | undefined) ?? []),
		...((operation.parameters as OpenApiParameter[] | undefined) ?? []),
	];
	const resolved = new Map<string, OpenApiParameter>();
	for (const entry of merged) {
		const parameter = resolveParameter(spec, entry);
		if (parameter?.name) resolved.set(`${parameter.in}:${parameter.name}`, parameter);
	}
	return [...resolved.values()];
}

export function toResolvedOperation(
	spec: OpenApiDocument,
	path: string,
	method: HttpMethod,
): ResolvedOperation {
	const paths = asRecord(spec.paths) as OpenApiDocument["paths"];
	const pathItem = asRecord(paths?.[path]);
	const operation = asRecord(pathItem[method]);
	const parameters = resolveOperationParameters(spec, pathItem, operation).map((parameter) => ({
		name: parameter.name!,
		in: parameter.in ?? "query",
		required: parameter.required ?? false,
		description: parameter.description,
		schema: resolveSchema(spec, parameter.schema),
	}));
	const rawRequestBody = asRecord(operation.requestBody);
	const requestBody = typeof rawRequestBody.$ref === "string"
		? asRecord(resolveRef(spec, { $ref: rawRequestBody.$ref }))
		: rawRequestBody;
	const descriptionSource = asRecord(requestBody.content);
	const jsonMedia = asRecord(descriptionSource["application/json"]);
	const requestBodySchema = jsonMedia.schema
		? resolveSchema(spec, jsonMedia.schema as OpenApiSchema)
		: undefined;
	const security = (operation.security ?? spec.security) as OpenApiDocument["security"];
	return {
		path,
		method,
		operationId: typeof operation.operationId === "string" ? operation.operationId : undefined,
		title: typeof operation.summary === "string" ? operation.summary : undefined,
		description: typeof operation.description === "string" ? operation.description : undefined,
		parameters,
		hasRequestBody: Boolean(operation.requestBody),
		requestBodyRequired: requestBody.required === true,
		requestBodyDescription:
			typeof requestBody.description === "string" ? requestBody.description : requestBodySchema?.description,
		requestBodySchema,
		requiredScopes: Array.isArray(operation["x-required-scopes"])
			? operation["x-required-scopes"].filter((scope): scope is string => typeof scope === "string")
			: [],
		// An empty alternative alongside bearerAuth denotes paid x402 access,
		// which this API-key client does not perform automatically.
		requiresApiKey: !security || !security.every((requirement) => Object.keys(requirement).length === 0),
	};
}

export function findOperationById(spec: OpenApiDocument, operationId: string): ResolvedOperation | undefined {
	for (const [path, pathItem] of Object.entries(asRecord(spec.paths))) {
		const item = asRecord(pathItem);
		for (const method of HTTP_METHODS) {
			const operation = asRecord(item[method]);
			if (operation.operationId === operationId) {
				return toResolvedOperation(spec, path, method);
			}
		}
	}
	return undefined;
}

export function candidatePaths(input: string): string[] {
	const pathname = (() => {
		try {
			return new URL(input).pathname;
		} catch {
			return input.startsWith("/") ? input : `/${input}`;
		}
	})();
	const candidates = [pathname];
	if (pathname.startsWith("/api/v1/")) {
		candidates.push(pathname.slice("/api/v1".length));
	}
	return [...new Set(candidates)];
}

export function toApiPath(openApiPath: string): string {
	return openApiPath.startsWith("/api/") ? openApiPath : `/api/v1${openApiPath}`;
}

export function findOperationByPath(spec: OpenApiDocument, path: string, method: string): ResolvedOperation | undefined {
	const normalizedMethod = method.toLowerCase() as HttpMethod;
	if (!HTTP_METHODS.includes(normalizedMethod)) return undefined;
	const paths = asRecord(spec.paths);
	for (const candidate of candidatePaths(path)) {
		if (paths[candidate] && asRecord(paths[candidate])[normalizedMethod]) {
			return toResolvedOperation(spec, candidate, normalizedMethod);
		}
	}
	return undefined;
}

/**
 * Build the concrete request from a resolved operation plus tool input.
 * Path params are interpolated and encoded; query/header params are serialized
 * with correct types (booleans, numbers, arrays as comma-separated values).
 */
export function buildRequestFromInput(
	operation: ResolvedOperation,
	input: Record<string, unknown>,
): { path: string; query: Record<string, string | undefined>; headers: Record<string, string>; body: unknown } {
	let path = operation.path;
	const query: Record<string, string | undefined> = {};
	const headers: Record<string, string> = {};
	let body: unknown;

	for (const parameter of operation.parameters) {
		const value = input[parameter.name];
		if (value === undefined || value === null || value === "") {
			if (parameter.required) throw new Error(`Missing required ${parameter.in} parameter: ${parameter.name}.`);
			continue;
		}
		switch (parameter.in) {
			case "path": {
				path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
				break;
			}
			case "query": {
				query[parameter.name] = Array.isArray(value)
					? value.map((entry) => String(entry)).join(",")
					: String(value);
				break;
			}
			case "header": {
				headers[parameter.name.toLowerCase()] = String(value);
				break;
			}
			default:
				break;
		}
	}

	if (operation.hasRequestBody && input.body !== undefined) {
		body = input.body;
	}

	return { path, query, headers, body };
}

export function summarizeOperations(spec: OpenApiDocument): Array<Record<string, unknown>> {
	const summary: Array<Record<string, unknown>> = [];
	for (const [path, pathItem] of Object.entries(asRecord(spec.paths))) {
		const item = asRecord(pathItem);
		for (const method of HTTP_METHODS) {
			const operation = asRecord(item[method]);
			if (!Object.keys(operation).length) continue;
			summary.push({
				operationId: operation.operationId,
				method: method.toUpperCase(),
				path,
				summary: operation.summary,
			});
		}
	}
	return summary.sort((a, b) => String(a.operationId).localeCompare(String(b.operationId)));
}

export const internalOpenApi = {
	asRecord,
	resolveRef,
	resolveParameter,
	resolveSchema,
	findOperationById,
};
