import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MAX_RESULT_BYTES,
	NativeDataError,
	present,
	readPage,
	resultSchema,
	safeUrl,
} from "../../worker/presentation.js";

const api = "https://api.y2.dev";
const profileId = `prf_${"1".repeat(24)}`;
const reportId = `rpt_${"2".repeat(24)}`;
const signalId = `sig_${"3".repeat(24)}`;
const entityId = `ent_${"4".repeat(24)}`;
const observationId = `obs_${"5".repeat(24)}`;
function page(data: unknown[]) {
	return { data, meta: { page: { nextCursor: null, hasMore: false } } };
}

describe("native public presentations", () => {
	it("unwraps subscribed profiles while excluding private configuration and internal identifiers", () => {
		const result = present(
			page([
				{
					subscription: { id: "internal_subscription" },
					profile: {
						id: profileId,
						name: "Energy",
						topic: "Supply continuity",
						_id: "internal_database_id",
						customInstructions: "private_prompt",
						configuration: { secret: "private_config" },
						lastDeliveredAt: "2026-10-04T08:00:00Z",
						userId: "internal_owner_id",
						links: { self: "/api/v1/profiles/leak?token=private_token" },
					},
				},
			]),
			"profile",
			api,
			"Research",
		);
		assert.equal(result.items[0]?.id, profileId);
		assert.equal(result.items[0]?.url, `https://y2.dev/app/connected/${profileId}`);
		assert.equal(result.items[0]?.lastDeliveredAt, "2026-10-04T08:00:00.000Z");
		assert.doesNotMatch(JSON.stringify(result), /private_|internal_/);
	});
	it("preserves report details instead of accidentally unwrapping their nested profile", () => {
		const result = present(
			{
				data: {
					id: reportId,
					profile: { id: profileId, name: "Parent profile" },
					topic: "Report topic",
					publishedAt: "2026-10-05T08:00:00-05:00",
					content: { markdown: "Report evidence" },
					sources: [
						{
							url: "https://example.com/filing",
							title: "Source filing",
							publishedAt: "2026-10-04T13:00:00Z",
						},
					],
				},
			},
			"report",
			api,
			"Research",
		);
		assert.equal(result.items[0]?.id, reportId);
		assert.equal(result.items[0]?.url, `https://y2.dev/app/connected/${reportId}`);
		assert.equal(result.items[0]?.title, "Report topic");
		assert.equal(result.items[0]?.content, "Report evidence");
		assert.equal(result.items[0]?.contentTruncated, false);
		assert.equal(result.items[0]?.timestampBasis, "publishedAt");
		assert.equal(result.items[0]?.timestamp, "2026-10-05T13:00:00.000Z");
		assert.equal(result.items[0]?.sources.length, 1);
	});
	it("unwraps the entity detail envelope without exposing arbitrary attributes", () => {
		const result = present(
			{
				data: {
					entity: {
						id: entityId,
						name: "Organization",
						aliases: ["Public alias"],
						externalIds: { secret: "internal_vendor_id" },
						updatedAt: "2026-10-05T10:00:00Z",
					},
					relatedEntities: [{ id: "internal_related" }],
				},
			},
			"entity",
			api,
			"Research",
		);
		assert.equal(result.items[0]?.id, entityId);
		assert.equal(result.items[0]?.url, `https://y2.dev/app/connected/${entityId}`);
		assert.equal(result.items[0]?.timestampBasis, "updatedAt");
		assert.deepEqual(result.items[0]?.aliases, ["Public alias"]);
		assert.doesNotMatch(JSON.stringify(result), /internal_/);
	});
	it("reads GeoJSON features and preserves an opaque next cursor from the canonical next link", () => {
		const result = present(
			{
				type: "FeatureCollection",
				features: [
					{
						type: "Feature",
						id: observationId,
						geometry: { type: "Point", coordinates: [-97.33, 32.75] },
						properties: {
							title: "Event",
							description: "Event facts",
							severity: "high",
							category: "economic",
							sourceType: "y2_report",
							provenance: { confidence: 0, rawData: { secret: "private_metadata" } },
							occurredAt: "2026-10-05T10:00:00Z",
							observedAt: "2026-10-05T12:00:00Z",
							url: "https://example.com/event",
						},
					},
				],
				links: [
					{
						rel: "next",
						href: "/api/v1/osint/regional?countryCode=US&cursor=y2p1_next",
					},
				],
			},
			"map",
			api,
			"Research",
		);
		assert.deepEqual(result.items[0]?.coordinates, [-97.33, 32.75]);
		assert.equal(result.items[0]?.priority, "high");
		assert.equal(result.items[0]?.category, "economic");
		assert.equal(result.items[0]?.sourceType, "y2_report");
		assert.equal(result.items[0]?.confidence, 0);
		assert.equal(result.items[0]?.timestamp, "2026-10-05T10:00:00.000Z");
		assert.equal(result.items[0]?.observedAt, "2026-10-05T12:00:00.000Z");
		assert.doesNotMatch(JSON.stringify(result), /private_metadata/);
		assert.equal(result.items[0]?.url, "https://example.com/event");
		assert.equal(result.nextCursor, "y2p1_next");
		assert.equal(result.hasMore, true);
	});
	it("labels signal timestamps as extraction time and preserves numeric zero confidence", () => {
		const result = present(
			page([
				{
					id: signalId,
					title: "Signal",
					signal: "Evidence",
					occurredAt: "2026-10-05T10:00:00Z",
					reportGeneratedAt: "2026-10-04T10:00:00Z",
					priority: "critical",
					confidence: 0,
					subjects: [
						{ label: "Company", kind: "company", entityId, key: "internal_subject_key" },
						{ label: "Sector", kind: "sector", entityId: "jinternal" },
						null,
					],
				},
			]),
			"signal",
			api,
			"Research",
		);
		assert.equal(result.items[0]?.timestampBasis, "extractedAt");
		assert.equal(result.items[0]?.confidence, 0);
		assert.deepEqual(result.items[0]?.subjects, [
			{ label: "Company", kind: "company", entityId },
			{ label: "Sector", kind: "sector", entityId: null },
		]);
		assert.doesNotMatch(JSON.stringify(result), /internal_subject_key|jinternal/);
	});
	it("omits malformed records and never treats internal or wrong-kind identifiers as public IDs", () => {
		const result = present(
			page([
				null,
				{},
				{ id: "j57internal", _id: profileId },
				{ id: reportId },
				{ subscription: {}, profile: null },
				{ id: profileId, name: "Valid" },
			]),
			"profile",
			api,
			"Research",
		);
		assert.equal(result.items.length, 1);
		assert.match(result.notice, /Omitted 5 malformed records/);
		assert.doesNotMatch(JSON.stringify(result), /j57internal/);
	});
	it("rejects invalid geometry, timestamp, priority, and confidence instead of inventing values", () => {
		const result = present(
			page([
				{
					id: observationId,
					title: "Event",
					geometry: { type: "Point", coordinates: [180.01, 33] },
					occurredAt: "yesterday",
					priority: "urgent",
					confidence: 500,
				},
			]),
			"map",
			api,
			"Research",
		);
		assert.equal(result.items[0]?.coordinates, null);
		assert.equal(result.items[0]?.timestamp, null);
		assert.equal(result.items[0]?.priority, null);
		assert.equal(result.items[0]?.confidence, null);
	});
	it("only returns safe bounded HTTPS source links", () => {
		const urls = [
			"javascript:alert(1)",
			"data:text/html,attack",
			"http://example.com/plaintext",
			"https://user:secret@example.com/",
			`https://example.com/${"a".repeat(2048)}`,
			"https://example.com/valid",
		];
		const result = present(
			page([
				{
					id: signalId,
					sources: urls.map((url) => ({ url, publishedAt: "not-a-date" })),
				},
			]),
			"signal",
			api,
			"Research",
		);
		assert.deepEqual(result.items[0]?.sources, [
			{ url: "https://example.com/valid", title: null, publishedAt: null },
		]);
		assert.equal(safeUrl("https://example.com/path"), "https://example.com/path");
	});
	it("truncates report excerpts on both character and UTF-8 byte limits and reports truncation", () => {
		const result = present(
			{
				data: {
					id: reportId,
					topic: "Long report",
					content: { markdown: "🔎".repeat(20_000) },
				},
			},
			"report",
			api,
			"Research",
		);
		assert.equal(result.items[0]?.contentTruncated, true);
		assert.ok(new TextEncoder().encode(result.items[0]?.content).byteLength <= 32_768);
		assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_RESULT_BYTES);
		assert.equal(resultSchema.safeParse(result).success, true);
	});
	it("rejects oversized records instead of silently dropping records behind a continuation cursor", () => {
		const rows = Array.from({ length: 51 }, (_, index) => ({
			id: `prf_${index.toString(16).padStart(24, "0")}`,
			name: "Profile",
		}));
		assert.throws(
			() => present(page(rows), "profile", api, "Research"),
			(error) => error instanceof NativeDataError && error.reason === "too_large",
		);
		assert.throws(
			() => readPage(page(Array.from({ length: 513 }, () => ({}))), "profile", api),
			NativeDataError,
		);
	});
	it("rejects malformed pagination instead of pretending an incomplete collection is complete", () => {
		for (const value of [
			{ error: "internal" },
			{ data: [], meta: { hasMore: true } },
			{ data: [], meta: { nextCursor: 12, hasMore: true } },
			{
				data: [],
				meta: {
					hasMore: false,
					page: { hasMore: true, nextCursor: "y2p1_next" },
				},
			},
			{
				type: "FeatureCollection",
				features: [],
				links: [{ rel: "next", href: "https://evil.test/steal?cursor=secret" }],
			},
		]) {
			assert.throws(() => present(value, "map", api, "Research"), NativeDataError);
		}
	});
});
