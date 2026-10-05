import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
	CIMD,
	hash,
	json,
	ORIGIN,
	REDIRECT,
	RESOURCE,
	required,
	WorkerFixture,
} from "./worker-auth-fixture.js";

let worker: WorkerFixture;
before(async () => {
	worker = await WorkerFixture.create();
});
after(async () => {
	await worker?.dispose();
});

test("workerd exposes OAuth discovery and rejects unauthenticated MCP", async () => {
	const denied = await worker.fetch("/mcp");
	assert.equal(denied.status, 401);
	assert.match(
		denied.headers.get("WWW-Authenticate") ?? "",
		/resource_metadata=/,
	);
	const resource = await json(
		await worker.fetch("/.well-known/oauth-protected-resource/mcp"),
	);
	assert.equal(resource.resource, RESOURCE);
	assert.deepEqual(resource.authorization_servers, [ORIGIN]);
	const metadata = await json(
		await worker.fetch("/.well-known/oauth-authorization-server"),
	);
	assert.equal(metadata.issuer, ORIGIN);
	assert.equal(metadata.authorization_endpoint, `${ORIGIN}/authorize`);
	assert.equal(metadata.token_endpoint, `${ORIGIN}/oauth/token`);
	assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
	assert.equal(metadata.client_id_metadata_document_supported, true);
});

test("CIMD clients complete the same browser consent and PKCE flow", async () => {
	const flow = await worker.authorize({ clientId: CIMD, method: "none" });
	const response = await worker.exchange(flow);
	assert.equal(response.status, 200, await response.clone().text());
	const tokens = await json(response);
	assert.equal(typeof tokens.access_token, "string");
	assert.equal(typeof tokens.refresh_token, "string");
});

test("registration rejects oversized client metadata before creating a client", async () => {
	const response = await worker.fetch("/oauth/register", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_name: "x".repeat(16_384),
			redirect_uris: [REDIRECT],
		}),
	});
	assert.equal(response.status, 400);
	assert.equal((await json(response)).error, "invalid_client_metadata");
});

test("authorization requires S256 and exact redirect/resource before app consent", async () => {
	const client = await worker.register();
	for (const override of [
		{ code_challenge_method: "plain" },
		{ code_challenge: "" },
		{ redirect_uri: "https://attacker.test/callback" },
		{ resource: "https://attacker.test/mcp" },
		{ scope: "profiles:write" },
	]) {
		const query = new URLSearchParams({
			response_type: "code",
			client_id: client.clientId,
			redirect_uri: REDIRECT,
			resource: RESOURCE,
			scope: "profiles:read",
			code_challenge: "x".repeat(43),
			code_challenge_method: "S256",
			...override,
		});
		const response = await worker.fetch(`/authorize?${query}`);
		assert.notEqual(
			response.headers.get("Location")?.startsWith("https://y2.test/"),
			true,
		);
		if (response.status === 302)
			assert(
				new URL(required(response.headers.get("Location"))).searchParams.has(
					"error",
				),
			);
		else assert.equal(response.status, 400);
		assert.equal(response.headers.get("Set-Cookie"), null);
	}
	const withoutResource = await worker.begin(client, ["profiles:read"], {
		resource: null,
	});
	assert.equal((await worker.complete(withoutResource, "deny")).status, 200);
});

test("omitted scope defaults to advertised read permissions and explicit consent still narrows", async () => {
	const flow = await worker.begin(await worker.register(), ["profiles:read"], {
		scope: null,
	});
	const details = await json(
		await worker.fetch(`/oauth/request/${flow.requestId}`),
	);
	assert.deepEqual(details.scopes, [
		"profiles:read",
		"reports:read",
		"osint:read",
		"intel:explorer",
		"intel:finint",
		"intel:cyber",
	]);
	const completed = await worker.complete(flow);
	assert.equal(completed.status, 200);
	const code = required(
		new URL(String((await json(completed)).redirectTo)).searchParams.get(
			"code",
		),
	);
	const response = await worker.exchange({ ...flow, code });
	assert.equal(response.status, 200);
	assert.equal((await json(response)).scope, "profiles:read");
});

test("confidential clients must also supply an S256 challenge before consent", async () => {
	for (const method of ["client_secret_basic", "client_secret_post"] as const) {
		const client = await worker.register(method);
		const query = new URLSearchParams({
			response_type: "code",
			client_id: client.clientId,
			redirect_uri: REDIRECT,
			resource: RESOURCE,
			scope: "profiles:read",
		});
		for (const challenge of [undefined, "malformed-challenge"]) {
			if (challenge) {
				query.set("code_challenge", challenge);
				query.set("code_challenge_method", "S256");
			}
			const response = await worker.fetch(`/authorize?${query}`);
			assert.equal(response.status, 400);
			assert.equal((await json(response)).error, "invalid_request");
			assert.equal(response.headers.get("Set-Cookie"), null);
		}
	}
});

test("DCR, browser-bound explicit consent, wrong PKCE then valid PKCE", async () => {
	const client = await worker.register();
	const flow = await worker.begin(client);
	const before = worker.backend.requests.filter((path) =>
		path.endsWith("/exchange"),
	).length;
	assert.equal(
		(
			await worker.complete(flow, "approve", {
				Origin: "https://attacker.test",
			})
		).status,
		403,
	);
	assert.equal(
		(await worker.complete(flow, "approve", { Cookie: "" })).status,
		400,
	);
	assert.equal(
		worker.backend.requests.filter((path) => path.endsWith("/exchange")).length,
		before,
	);
	const completed = await worker.complete(flow);
	assert.equal(completed.status, 200, await completed.clone().text());
	const redirect = new URL(String((await json(completed)).redirectTo));
	const authorized = {
		...flow,
		code: required(redirect.searchParams.get("code")),
	};
	for (const malformed of ["", "short", "x".repeat(129), "!".repeat(43)]) {
		const response = await worker.exchange(authorized, malformed);
		assert.equal(response.status, 400);
		assert.equal((await json(response)).error, "invalid_request");
		assert.equal(worker.backend.redemptions.has(hash(authorized.code)), false);
	}
	const failed = await worker.exchange(authorized, "x".repeat(43));
	assert.equal(failed.status, 400);
	assert.equal((await json(failed)).error, "invalid_grant");
	assert.equal(worker.backend.redemptions.has(hash(authorized.code)), false);
	const valid = await worker.exchange(authorized);
	assert.equal(valid.status, 200, await valid.clone().text());
	const tokens = await json(valid);
	assert.equal(typeof tokens.access_token, "string");
	assert.equal(typeof tokens.refresh_token, "string");
	assert.equal(
		worker.backend.redemptions.get(hash(authorized.code))?.state,
		"spent",
	);
	assert.equal((await worker.complete(flow)).status, 400);
	const repeated = await worker.exchange(authorized);
	assert.equal(repeated.status, 400);
	assert.equal((await json(repeated)).error, "invalid_grant");
	assert.equal(
		required(worker.backend.redemptions.get(hash(authorized.code))).connection
			.active,
		false,
	);
	assert.equal(
		(await worker.rpc(String(tokens.access_token), "tools/list")).status,
		401,
	);
});

test("denying consent returns access_denied without minting a backend connection", async () => {
	const flow = await worker.begin(await worker.register());
	const count = worker.backend.connections.size;
	const denied = await worker.complete(flow, "deny");
	assert.equal(denied.status, 200);
	const redirect = new URL(String((await json(denied)).redirectTo));
	assert.equal(redirect.searchParams.get("error"), "access_denied");
	assert.equal(redirect.searchParams.get("state"), "state-anti-csrf");
	assert.equal(worker.backend.connections.size, count);
	assert.equal((await worker.complete(flow)).status, 400);
});

test("explicit approval may narrow scopes and cannot expand the original request", async () => {
	const client = await worker.register();
	const selected = await worker.begin(client);
	required(worker.backend.tickets.get(selected.ticket)).scopes = [
		"profiles:read",
	];
	const completed = await worker.complete(selected);
	assert.equal(completed.status, 200);
	const code = required(
		new URL(String((await json(completed)).redirectTo)).searchParams.get(
			"code",
		),
	);
	const tokens = await json(await worker.exchange({ ...selected, code }));
	assert.equal(tokens.scope, "profiles:read offline_access");
	assert.equal(
		(await worker.rpc(String(tokens.access_token), "tools/list")).status,
		200,
	);
	const expanded = await worker.begin(client, ["profiles:read"]);
	required(worker.backend.tickets.get(expanded.ticket)).scopes = [
		"profiles:read",
		"reports:read",
	];
	const rejected = await worker.complete(expanded);
	assert.equal(rejected.status, 400);
	assert.equal((await json(rejected)).redirectTo, undefined);
	// A second authorization must not silently revoke a first workspace grant.
	assert.equal(
		(await worker.rpc(String(tokens.access_token), "tools/list")).status,
		200,
	);
});
