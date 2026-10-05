import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
	hash,
	json,
	REDIRECT,
	required,
	rpcJson,
	WorkerFixture,
} from "./worker-auth-fixture.js";

let worker: WorkerFixture;
before(async () => {
	worker = await WorkerFixture.create();
});
after(async () => {
	await worker?.dispose();
});

test("replay verification fails closed when the gateway credential is missing", async () => {
	const unconfigured = await WorkerFixture.create("");
	try {
		const flow = await unconfigured.authorize(await unconfigured.register());
		assert.equal((await unconfigured.exchange(flow)).status, 200);
		const calls = unconfigured.backend.requests.filter((path) =>
			path.endsWith("/replay"),
		).length;
		const repeated = await unconfigured.exchange(flow);
		assert.equal(repeated.status, 503);
		assert.equal((await json(repeated)).error, "temporarily_unavailable");
		assert.equal(
			unconfigured.backend.requests.filter((path) => path.endsWith("/replay"))
				.length,
			calls,
		);
	} finally {
		await unconfigured.dispose();
	}
});

test("another client or resource cannot revoke a spent authorization code's connection", async () => {
	const flow = await worker.authorize(await worker.register());
	const tokens = await json(await worker.exchange(flow));
	const connection = required(
		worker.backend.redemptions.get(hash(flow.code)),
	).connection;
	const parameters = {
		grant_type: "authorization_code",
		code: flow.code,
		redirect_uri: REDIRECT,
		code_verifier: flow.verifier,
	};
	const anotherClient = await worker.token(await worker.register(), parameters);
	assert.equal((await json(anotherClient)).error, "invalid_grant");
	assert.equal(connection.active, true);
	const anotherResource = await worker.token(flow.client, {
		...parameters,
		resource: "https://different-resource.test/mcp",
	});
	assert.equal((await json(anotherResource)).error, "invalid_target");
	assert.equal(connection.active, true);
	assert.equal(
		(await worker.rpc(String(tokens.access_token), "tools/list")).status,
		200,
	);
});

test("refresh requests cannot add permissions outside the explicitly approved scope", async () => {
	const flow = await worker.authorize(await worker.register(), [
		"profiles:read",
	]);
	const initial = await json(await worker.exchange(flow));
	const expanded = await worker.token(flow.client, {
		grant_type: "refresh_token",
		refresh_token: String(initial.refresh_token),
		scope: "profiles:read reports:read profiles:write",
	});
	assert.equal(expanded.status, 200);
	const issued = await json(expanded);
	assert.equal(issued.scope, "profiles:read");
	const disjoint = await worker.token(flow.client, {
		grant_type: "refresh_token",
		refresh_token: String(issued.refresh_token),
		scope: "reports:read",
	});
	assert.equal(disjoint.status, 400);
	assert.equal((await json(disjoint)).error, "invalid_scope");
	assert.equal(
		worker.backend.redemptions.has(hash(String(issued.refresh_token))),
		false,
	);
	assert.equal(
		required(worker.backend.redemptions.get(hash(flow.code))).connection.active,
		true,
	);
});

test("refresh scope narrowing reaches real MCP tools and backend revocation is immediate", async () => {
	const flow = await worker.authorize(await worker.register());
	const exchanged = await worker.exchange(flow);
	assert.equal(exchanged.status, 200, await exchanged.clone().text());
	const original = await json(exchanged);
	const refreshed = await worker.token(flow.client, {
		grant_type: "refresh_token",
		refresh_token: String(original.refresh_token),
		scope: "profiles:read",
	});
	assert.equal(refreshed.status, 200, await refreshed.clone().text());
	const narrowed = await json(refreshed);
	assert.equal(narrowed.scope, "profiles:read");
	const token = String(narrowed.access_token);
	const profiles = await worker.rpc(token, "tools/call", {
		name: "y2_list_profiles",
		arguments: {},
	});
	assert.equal(profiles.status, 200, await profiles.clone().text());
	const result = (await rpcJson(profiles)).result as Record<string, unknown>;
	assert.equal(result.isError, undefined);
	assert(result.structuredContent);
	const reportCalls = worker.backend.requests.filter(
		(path) => path === "/api/v1/reports",
	).length;
	const reports = await worker.rpc(token, "tools/call", {
		name: "y2_list_reports",
		arguments: {},
	});
	const reportResult = (await rpcJson(reports)).result as Record<
		string,
		unknown
	>;
	assert.equal(reportResult.isError, true);
	assert.equal(
		worker.backend.requests.filter((path) => path === "/api/v1/reports").length,
		reportCalls,
	);
	const connection = required(
		worker.backend.redemptions.get(hash(flow.code)),
	).connection;
	connection.active = false;
	assert.equal((await worker.rpc(token, "tools/list")).status, 401);
});

for (const method of [
	"none",
	"client_secret_basic",
	"client_secret_post",
] as const) {
	test(`old refresh replay revokes its connection for ${method} clients`, async () => {
		const flow = await worker.authorize(await worker.register(method));
		const initial = await json(await worker.exchange(flow));
		const firstResponse = await worker.token(flow.client, {
			grant_type: "refresh_token",
			refresh_token: String(initial.refresh_token),
		});
		assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
		const first = await json(firstResponse);
		const nextResponse = await worker.token(flow.client, {
			grant_type: "refresh_token",
			refresh_token: String(first.refresh_token),
		});
		assert.equal(nextResponse.status, 200, await nextResponse.clone().text());
		const next = await json(nextResponse);
		const connection = required(
			worker.backend.redemptions.get(hash(flow.code)),
		).connection;
		if (method !== "none") {
			const before = worker.backend.requests.filter((path) =>
				path.endsWith("/replay"),
			).length;
			const failed = await worker.token(
				{ ...flow.client, clientSecret: "wrong-secret" },
				{
					grant_type: "refresh_token",
					refresh_token: String(initial.refresh_token),
				},
			);
			assert.equal((await json(failed)).error, "invalid_client");
			assert.equal(
				worker.backend.requests.filter((path) => path.endsWith("/replay"))
					.length,
				before,
			);
			assert.equal(connection.active, true);
		}
		if (method === "none") {
			const otherClient = await worker.register();
			await worker.token(otherClient, {
				grant_type: "refresh_token",
				refresh_token: String(initial.refresh_token),
			});
			assert.equal(
				connection.active,
				true,
				"A different client must not revoke this connection",
			);
			await worker.token(flow.client, {
				grant_type: "refresh_token",
				refresh_token: String(initial.refresh_token),
				resource: "https://different-resource.test/mcp",
			});
			assert.equal(
				connection.active,
				true,
				"A different resource must not revoke this connection",
			);
		}
		const replay = await worker.token(flow.client, {
			grant_type: "refresh_token",
			refresh_token: String(initial.refresh_token),
		});
		assert.equal(replay.status, 400);
		assert.equal((await json(replay)).error, "invalid_grant");
		assert.equal(connection.active, false);
		assert.equal(
			(await worker.rpc(String(next.access_token), "tools/list")).status,
			401,
		);
	});
}

test("code replay during finalization rejects both exchanges without delivering revoked tokens", {
	timeout: 10_000,
}, async () => {
	const flow = await worker.authorize(await worker.register());
	let notifyReached!: () => void;
	const reached = new Promise<void>((resolve) => {
		notifyReached = resolve;
	});
	let allowFinalize!: () => void;
	const held = new Promise<void>((resolve) => {
		allowFinalize = resolve;
	});
	worker.backend.beforeFinalize = async () => {
		notifyReached();
		await held;
	};
	let delivered = false;
	const first = worker.exchange(flow).then((response) => {
		delivered = true;
		return response;
	});
	try {
		await reached;
		assert.equal(delivered, false);
		const repeated = await worker.exchange(flow);
		assert.equal(repeated.status, 400);
		const rejected = await json(repeated);
		assert.equal(rejected.error, "invalid_grant");
		assert.equal(rejected.access_token, undefined);
		assert.equal(rejected.refresh_token, undefined);
		assert.equal(
			required(worker.backend.redemptions.get(hash(flow.code))).connection
				.active,
			false,
		);
	} finally {
		allowFinalize();
		worker.backend.beforeFinalize = undefined;
	}
	const finalized = await first;
	assert.equal(finalized.status, 400);
	const rejected = await json(finalized);
	assert.equal(rejected.error, "invalid_grant");
	assert.equal(rejected.access_token, undefined);
	assert.equal(rejected.refresh_token, undefined);
	assert.equal(
		worker.backend.redemptions.get(hash(flow.code))?.state,
		"pending",
	);
});

test("token bytes wait for finalization and another pending refresh cannot revoke the winner", {
	timeout: 10_000,
}, async () => {
	const flow = await worker.authorize(await worker.register());
	const tokens = await json(await worker.exchange(flow));
	let notifyReached!: () => void;
	const reached = new Promise<void>((resolve) => {
		notifyReached = resolve;
	});
	let allowFinalize!: () => void;
	const held = new Promise<void>((resolve) => {
		allowFinalize = resolve;
	});
	worker.backend.beforeFinalize = async () => {
		notifyReached();
		await held;
	};
	const refresh = {
		grant_type: "refresh_token",
		refresh_token: String(tokens.refresh_token),
	};
	let delivered = false;
	const first = worker.token(flow.client, refresh).then((response) => {
		delivered = true;
		return response;
	});
	try {
		await reached;
		assert.equal(delivered, false);
		const competing = await worker.token(flow.client, refresh);
		assert.equal(competing.status, 503, await competing.clone().text());
		assert.equal((await json(competing)).error, "temporarily_unavailable");
		assert.equal(
			required(worker.backend.redemptions.get(hash(flow.code))).connection
				.active,
			true,
		);
	} finally {
		allowFinalize();
		worker.backend.beforeFinalize = undefined;
	}
	const winner = await first;
	assert.equal(winner.status, 200);
	const issued = await json(winner);
	assert.equal(
		worker.backend.redemptions.get(hash(String(tokens.refresh_token)))?.state,
		"spent",
	);
	assert.equal(
		(await worker.rpc(String(issued.access_token), "tools/list")).status,
		200,
	);
});

for (const fault of [
	"failClaim",
	"malformedClaim",
	"malformedFinalize",
	"failFinalize",
] as const) {
	test(`token delivery fails closed when backend ${fault}`, async () => {
		const flow = await worker.authorize(await worker.register());
		worker.backend[fault] = true;
		try {
			const response = await worker.exchange(flow);
			assert.notEqual(response.status, 200);
			const body = await json(response);
			assert.equal(body.access_token, undefined);
			assert.equal(body.refresh_token, undefined);
		} finally {
			worker.backend[fault] = false;
		}
		if (fault === "failClaim") {
			assert.equal(
				(await worker.exchange(flow)).status,
				200,
				"An unclaimed code can be retried",
			);
		} else {
			assert.equal(
				worker.backend.redemptions.get(hash(flow.code))?.state,
				"pending",
			);
			if (fault === "malformedClaim")
				assert.equal((await worker.exchange(flow)).status, 503);
		}
	});
}

test("oversized or repeated token parameters are rejected before the ledger", async () => {
	const calls = worker.backend.requests.length;
	for (const body of [
		"grant_type=refresh_token&grant_type=authorization_code",
		`grant_type=refresh_token&refresh_token=${"x".repeat(16_384)}`,
	]) {
		const response = await worker.fetch("/oauth/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
		assert.equal(response.status, 400);
		assert.equal((await json(response)).error, "invalid_request");
	}
	assert.equal(worker.backend.requests.length, calls);
});
