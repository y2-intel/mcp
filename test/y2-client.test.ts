import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { Y2ApiError } from "../src/errors.js";
import { Y2Client } from "../src/y2-client.js";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(body), {
		...init,
		headers: {
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
}

describe("Y2Client", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("sends bearer auth and query parameters", async () => {
		const requests: Request[] = [];
		globalThis.fetch = async (input, init) => {
			requests.push(new Request(input, init));
			return jsonResponse({ ok: true });
		};

		const client = new Y2Client(
			loadConfig({
				Y2_API_KEY: "y2_test",
				Y2_API_BASE_URL: "https://api.example.com",
			}),
		);

		assert.deepEqual(
			await client.requestJson("/api/v1/reports", { query: { limit: "1" } }),
			{ ok: true },
		);
		assert.equal(requests[0].url, "https://api.example.com/api/v1/reports?limit=1");
		assert.equal(requests[0].headers.get("authorization"), "Bearer y2_test");
	});

	it("converts Agent Y2 streams into final text and thread id", async () => {
		globalThis.fetch = async () =>
			new Response('0:"Hello "\n0:"world"\n', {
				headers: { "x-thread-id": "thread_123" },
			});

		const client = new Y2Client(loadConfig({ Y2_API_KEY: "y2_test" }));
		const result = await client.askAgent({ message: "Brief me" });

		assert.equal(result.text, "Hello world");
		assert.equal(result.threadId, "thread_123");
		assert.equal(result.status, 200);
	});

	it("throws structured API errors", async () => {
		globalThis.fetch = async () =>
			jsonResponse(
				{ error: { code: "INSUFFICIENT_SCOPE", message: "Requires agent:y2" } },
				{ status: 403, headers: { "retry-after": "60" } },
			);

		const client = new Y2Client(loadConfig({ Y2_API_KEY: "y2_test" }));

		await assert.rejects(
			() => client.requestJson("/api/v1/reports"),
			(error: unknown) => {
				assert.ok(error instanceof Y2ApiError);
				assert.equal(error.status, 403);
				assert.equal(error.code, "INSUFFICIENT_SCOPE");
				assert.equal(error.retryAfter, "60");
				assert.equal(error.message, "Requires agent:y2");
				return true;
			},
		);
	});
});
