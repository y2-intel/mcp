import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candidatePaths } from "../src/openapi.js";

describe("candidateOpenApiPaths", () => {
	const candidateOpenApiPaths = candidatePaths;
	it("accepts Y2 API v1 paths and OpenAPI-relative paths", () => {
		assert.deepEqual(candidateOpenApiPaths("/api/v1/reports"), [
			"/api/v1/reports",
			"/reports",
		]);
		assert.deepEqual(candidateOpenApiPaths("/reports"), ["/reports"]);
	});

	it("accepts full Y2 API URLs", () => {
		assert.deepEqual(candidateOpenApiPaths("https://api.y2.dev/api/v1/news"), [
			"/api/v1/news",
			"/news",
		]);
	});
});
