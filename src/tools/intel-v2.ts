import { z } from "zod";
import type { ApiToolDefinition } from "./api-definition.js";
import { additiveExternalToolAnnotations, readOnlyExternalToolAnnotations } from "./metadata.js";

const entityId = z
	.string()
	.regex(/^ent_[a-f0-9]{24}$/)
	.describe("Stable public entity ID.");
const subjectId = z
	.string()
	.regex(/^sbj_[a-f0-9]{24}$/)
	.describe("Stable public ledger subject ID.");
const cursor = z
	.string()
	.min(1)
	.optional()
	.describe("Opaque next cursor; preserve the original path and filters.");
const pageLimit = z.number().int().min(1).max(50).default(25);
const recordedAt = z.iso
	.datetime({ offset: true })
	.optional()
	.describe("Record-time cursor; omit for the latest record.");
const validAt = z.iso
	.datetime({ offset: true })
	.optional()
	.describe("Valid-time cursor; omit to ignore valid intervals.");
const ledgerPage = {
	afterSeq: z
		.number()
		.int()
		.min(0)
		.default(0)
		.describe("Return sealed lines with a sequence greater than this."),
	limit: z.number().int().min(1).max(200).default(100),
};
const idempotencyKey = z
	.string()
	.min(8)
	.max(200)
	.regex(/^[A-Za-z0-9._:-]+$/)
	.optional()
	.describe("Client retry key retained for 24 hours; reuse only with the same JSON body.");

const ledgerRecord = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("designator"),
			designator: z
				.object({
					kind: z.enum([
						"published-name",
						"pseudonym",
						"handle",
						"email",
						"url",
						"domain",
						"hostname",
						"asn",
						"public-key",
						"external-id",
						"ticker",
					]),
					value: z.string().describe("Designator value; canonicalized by the API on write."),
					namespace: z.string().optional(),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("observation"),
			observation: z
				.object({
					method: z.enum([
						"public-web-page",
						"public-profile",
						"public-dns",
						"certificate-transparency",
						"public-archive",
						"public-registry",
						"public-code-host",
						"analyst-note",
					]),
					sourceGrade: z.enum(["primary", "secondary", "analytic"]),
					sourceUrl: z.string().optional(),
					archiveUrl: z.string().optional(),
					retrievedAt: z.iso.datetime({ offset: true }).optional(),
					excerpt: z.string().max(500).optional(),
					contentHash: z
						.string()
						.regex(/^[0-9a-f]{64}$/)
						.optional(),
					collector: z.string().max(80),
					cites: z.array(z.string()).optional(),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("claim"),
			claim: z
				.object({
					op: z.enum(["assert", "retract"]).default("assert"),
					predicate: z.enum([
						"designated-by",
						"preferred-label",
						"same-as",
						"distinct-from",
						"member-of",
						"affiliated-with",
						"controls",
						"operates",
						"resolves-to",
						"follows",
						"supplies",
						"subsidiary-of",
					]),
					from: z.string(),
					to: z.string(),
					qualifier: z.string().optional(),
					supersedes: z
						.string()
						.optional()
						.describe("Current head of this claim key; required after the first line."),
					confidence: z.number().int().min(0).max(100).optional(),
					verification: z
						.enum([
							"unverified",
							"mentioned",
							"located",
							"self-asserted",
							"cross-linked",
							"corroborated",
							"contradicted",
							"stale",
							"analytic",
						])
						.optional(),
					validFrom: z.iso.datetime({ offset: true }).optional(),
					validTo: z.iso.datetime({ offset: true }).optional(),
					evidenceRefs: z.array(z.string()).min(1).max(20),
					note: z.string().max(1000).optional(),
				})
				.strict(),
		})
		.strict(),
]);

export const intelV2ReadTools: ApiToolDefinition[] = [
	{
		name: "y2_list_company_financial_observations_v2",
		title: "List Company Financial Observations",
		description: "List workspace company financial history. Requires intel:finint.",
		method: "GET",
		path: "/api/v2/entities/{entityId}/financial-observations",
		scopes: ["intel:finint"],
		inputSchema: {
			entityId,
			metricKey: z
				.string()
				.regex(/^[a-z0-9_]{1,80}$/)
				.optional(),
			factType: z.enum(["actual", "estimate", "guidance"]).optional(),
			limit: pageLimit,
			cursor,
		},
		pathParams: ["entityId"],
		queryParams: ["metricKey", "factType", "limit", "cursor"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_entity_fusion_v2",
		title: "Get Entity Fusion",
		description: "Get cyber-market fusion for a company entity. Requires intel:explorer.",
		method: "GET",
		path: "/api/v2/entities/{entityId}/fusion",
		scopes: ["intel:explorer"],
		inputSchema: {
			entityId,
			windowDays: z.number().int().min(1).max(365).default(90),
			adjacencyDays: z.number().int().min(1).max(90).default(7),
		},
		pathParams: ["entityId"],
		queryParams: ["windowDays", "adjacencyDays"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_ledger_subjects_v2",
		title: "List Ledger Subjects",
		description: "List workspace evidence ledger subjects. Requires ledger:read.",
		method: "GET",
		path: "/api/v2/ledger/subjects",
		scopes: ["ledger:read"],
		inputSchema: { entityId: entityId.optional(), limit: pageLimit, cursor },
		queryParams: ["entityId", "limit", "cursor"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_ledger_subject_v2",
		title: "Get Ledger Subject",
		description: "Fold a ledger subject at optional record and valid times. Requires ledger:read.",
		method: "GET",
		path: "/api/v2/ledger/subjects/{subjectId}",
		scopes: ["ledger:read"],
		inputSchema: { subjectId, recordedAt, validAt },
		pathParams: ["subjectId"],
		queryParams: ["recordedAt", "validAt"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_ledger_subject_stix_v2",
		title: "Export Ledger Subject as STIX",
		description:
			"Export a ledger subject as STIX 2.1, optionally including retracted history. Requires ledger:read.",
		method: "GET",
		path: "/api/v2/ledger/subjects/{subjectId}/stix",
		scopes: ["ledger:read"],
		inputSchema: { subjectId, recordedAt, validAt, history: z.boolean().default(false) },
		pathParams: ["subjectId"],
		queryParams: ["recordedAt", "validAt", "history"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_ledger_records_v2",
		title: "List Ledger Records",
		description: "Export a bounded page of sealed ledger lines. Requires ledger:read.",
		method: "GET",
		path: "/api/v2/ledger/records",
		scopes: ["ledger:read"],
		inputSchema: ledgerPage,
		queryParams: ["afterSeq", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_verify_ledger_v2",
		title: "Verify Ledger Seal",
		description:
			"Verify a bounded page of ledger seals without changing records. Requires ledger:read.",
		method: "GET",
		path: "/api/v2/ledger/verify",
		scopes: ["ledger:read"],
		inputSchema: ledgerPage,
		queryParams: ["afterSeq", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
];

export const intelV2WriteTools: ApiToolDefinition[] = [
	{
		name: "y2_open_ledger_subject_v2",
		title: "Open Ledger Subject",
		description:
			"Create an immutable-class ledger subject. Requires ledger:write and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "POST",
		path: "/api/v2/ledger/subjects",
		scopes: ["ledger:write"],
		inputSchema: {
			idempotencyKey,
			body: z
				.object({
					class: z.enum(["person", "organization", "system"]),
					entityId: entityId.optional(),
				})
				.strict(),
		},
		bodyParam: "body",
		headerParams: ["idempotencyKey:Idempotency-Key"],
		annotations: additiveExternalToolAnnotations,
	},
	{
		name: "y2_append_ledger_record_v2",
		title: "Append Ledger Record",
		description:
			"Append a designator, passive observation, or evidence-backed claim to the ledger. Requires ledger:write and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "POST",
		path: "/api/v2/ledger/records",
		scopes: ["ledger:write"],
		inputSchema: { idempotencyKey, body: ledgerRecord },
		bodyParam: "body",
		headerParams: ["idempotencyKey:Idempotency-Key"],
		annotations: additiveExternalToolAnnotations,
	},
];
