import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractAssistantTextFromStream } from "../src/stream.js";

describe("extractAssistantTextFromStream", () => {
	it("extracts Vercel AI SDK data stream text chunks", () => {
		const raw = ['0:"Hello "', '0:"world"', "d:{\"finishReason\":\"stop\"}"].join("\n");
		assert.equal(extractAssistantTextFromStream(raw), "Hello world");
	});

	it("extracts OpenAI-compatible SSE chunks", () => {
		const raw = [
			'data: {"choices":[{"delta":{"content":"Hello "}}]}',
			'data: {"choices":[{"delta":{"content":"world"}}]}',
			"data: [DONE]",
		].join("\n");
		assert.equal(extractAssistantTextFromStream(raw), "Hello world");
	});

	it("ignores non-text stream parts", () => {
		const raw = ['2:[{"toolCallId":"call_1"}]', '0:"Done"'].join("\n");
		assert.equal(extractAssistantTextFromStream(raw), "Done");
	});
});
