import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MAX_VISIBLE_ITEMS,
	mapFilterRequest,
	mergePage,
	pageRequest,
	parseViewMetadata,
	querySummary,
	RequestGate,
	timeLabel,
} from "../ui/view-state.js";
import type { NativeResult } from "../worker/presentation.js";
import { MAX_CURSOR_LENGTH } from "../worker/presentation.js";

function result(
	ids: string[],
	overrides: Partial<NativeResult> = {},
): NativeResult {
	return {
		schemaVersion: "1.0",
		kind: "signal",
		workspaceName: "Test workspace",
		retrievedAt: "2026-10-05T12:00:00.000Z",
		nextCursor: "page-two",
		hasMore: true,
		notice: "Synthetic fixture.",
		items: ids.map((id) => ({
			id,
			title: id,
			summary: "Fixture",
			url: "https://example.com",
			kind: "signal",
			timestamp: null,
			timestampBasis: "unavailable",
			priority: null,
			confidence: null,
			sources: [],
			coordinates: null,
		})),
		...overrides,
	};
}

describe("native UI query and pagination boundaries", () => {
	it("preserves domain and time filters without accepting unexpected tool arguments", () => {
		const meta = parseViewMetadata(
			{
				query: {
					domain: "cyber",
					sinceMs: 10,
					untilMs: 20,
					entityId: "ent_123456",
					q: "test",
					limit: 20,
					url: "https://attacker.example",
					body: { write: true },
				},
				grantedScopes: ["intel:cyber", 4],
			},
			"signal",
		);
		assert.deepEqual(meta.scopes, ["intel:cyber"]);
		assert.deepEqual(
			pageRequest({ ...meta, result: result(["one"]), priority: "" }),
			{
				name: "y2_list_signals_v2",
				args: {
					domain: "cyber",
					sinceMs: 10,
					untilMs: 20,
					entityId: "ent_123456",
					q: "test",
					limit: 20,
					cursor: "page-two",
				},
			},
		);
	});
	it("does not broaden a query when metadata is missing or malformed", () => {
		for (const metadata of [
			undefined,
			{},
			{ query: [] },
			{ query: { domain: { invalid: true } } },
		]) {
			const meta = parseViewMetadata(metadata, "signal");
			assert.equal(
				pageRequest({ ...meta, result: result(["one"]), priority: "" }),
				null,
			);
		}
	});
	it("accepts the bounded server cursor length without losing query filters", () => {
		const query = {
			cursor: "x".repeat(MAX_CURSOR_LENGTH),
			countryCode: "US",
			category: "seismic",
		};
		assert.deepEqual(parseViewMetadata({ query }, "map").query, query);
		assert.equal(
			parseViewMetadata({ query: { cursor: `${query.cursor}x` } }, "map").query,
			undefined,
		);
	});
	it("retains previous results and updates duplicate IDs as additional pages arrive", () => {
		const next = result(["one", "two"]);
		const firstItem = next.items[0];
		assert.ok(firstItem);
		firstItem.title = "Updated title";
		const merged = mergePage(result(["zero", "one"]), next);
		assert.deepEqual(
			merged.items.map((item) => item.id),
			["zero", "one", "two"],
		);
		assert.equal(merged.items[1]?.title, "Updated title");
	});
	it("stops at a disclosed cap instead of silently dropping the first page", () => {
		const first = result(
			Array.from({ length: MAX_VISIBLE_ITEMS }, (_, index) => String(index)),
		);
		const merged = mergePage(first, result(["extra"]));
		assert.equal(merged.items.length, MAX_VISIBLE_ITEMS);
		assert.equal(merged.items[0]?.id, "0");
		assert.equal(
			pageRequest({ result: merged, query: {}, scopes: [], priority: "" }),
			null,
		);
	});
	it("discloses results beyond the display cap even when the server returned its last page", () => {
		const first = result(
			Array.from({ length: MAX_VISIBLE_ITEMS - 1 }, (_, index) =>
				String(index),
			),
		);
		const last = result(["last-visible", "beyond-cap"], {
			hasMore: false,
			nextCursor: null,
		});
		const merged = mergePage(first, last);
		assert.equal(merged.items.length, MAX_VISIBLE_ITEMS);
		assert.equal(merged.hasMore, true);
		assert.equal(
			pageRequest({ result: merged, query: {}, scopes: [], priority: "" }),
			null,
		);
	});
	it("rejects appending results from a different workspace or view", () => {
		assert.throws(
			() =>
				mergePage(
					result(["one"]),
					result(["two"], { workspaceName: "Other workspace" }),
				),
			/context changed/,
		);
		assert.throws(
			() => mergePage(result(["one"]), result(["two"], { kind: "profile" })),
			/context changed/,
		);
	});
});

describe("native map filters", () => {
	const view = {
		result: result([], { kind: "map" }),
		query: {
			countryCode: "US",
			q: "earthquake",
			datetime: "2026-10-01T00:00:00Z/2026-10-05T00:00:00Z",
			cursor: "old-page",
			category: "seismic",
		},
		scopes: ["osint:read"],
		priority: "",
	};
	it("keeps geographic and time context while replacing filters and resetting pagination", () => {
		assert.deepEqual(
			mapFilterRequest(view, {
				category: "weather",
				severity: "high",
				timeRange: "",
			}),
			{
				name: "y2_query_map",
				args: {
					countryCode: "US",
					q: "earthquake",
					datetime: view.query.datetime,
					category: "weather",
					severity: "high",
				},
			},
		);
	});
	it("builds a precise event-time interval only after selecting a new range", () => {
		const request = mapFilterRequest(
			view,
			{ category: "", severity: "", timeRange: "day" },
			Date.parse("2026-10-05T12:00:00Z"),
		);
		assert.equal(
			request?.args.datetime,
			"2026-10-04T12:00:00.000Z/2026-10-05T12:00:00.000Z",
		);
		assert.equal(request?.args.category, undefined);
	});
	it("does not issue a broader query without metadata, authorization, or valid filters", () => {
		const filters = { category: "", severity: "", timeRange: "" };
		assert.equal(
			mapFilterRequest({ ...view, query: undefined }, filters),
			null,
		);
		assert.equal(mapFilterRequest({ ...view, scopes: [] }, filters), null);
		assert.equal(
			mapFilterRequest(view, { ...filters, category: "invalid" }),
			null,
		);
		assert.equal(
			mapFilterRequest(view, { ...filters, timeRange: "all-time" }),
			null,
		);
		assert.equal(
			mapFilterRequest(view, { ...filters, severity: "highest" }),
			null,
		);
	});
	it("discloses the query context without showing opaque cursors", () => {
		const label = querySummary(view);
		assert.match(label, /Country: US/);
		assert.match(label, /Category: seismic/);
		assert.match(label, /Event time:/);
		assert.doesNotMatch(label, /old-page/);
		assert.match(querySummary({ ...view, query: undefined }), /unavailable/);
	});
});

describe("native UI async request ownership", () => {
	it("cancels stale requests when a newer host result or navigation takes ownership", () => {
		const gate = new RequestGate();
		const first = gate.begin();
		const second = gate.begin();
		assert.equal(first.signal.aborted, true);
		assert.equal(gate.isCurrent(first), false);
		assert.equal(gate.isCurrent(second), true);
		gate.invalidate();
		assert.equal(second.signal.aborted, true);
		assert.equal(gate.isCurrent(second), false);
	});
	it("does not let a late completion become current again", async () => {
		const gate = new RequestGate();
		const old = gate.begin();
		const completion = Promise.resolve().then(() => gate.isCurrent(old));
		const current = gate.begin();
		assert.equal(await completion, false);
		assert.equal(gate.isCurrent(current), true);
	});
	it("renders unavailable or unsupported time settings safely", () => {
		assert.equal(timeLabel("not-a-date"), "time unavailable");
		assert.equal(
			timeLabel("2026-10-05T12:00:00Z", { timeZone: "invalid/zone" }),
			"2026-10-05T12:00:00.000Z",
		);
	});
});
