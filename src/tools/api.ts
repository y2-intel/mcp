import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Y2McpConfig } from "../config.js";
import { errorResult, formatJson, limitText, textResult } from "../text.js";
import type { Y2Client } from "../y2-client.js";
import {
	additiveExternalToolAnnotations,
	destructiveExternalToolAnnotations,
	readOnlyExternalToolAnnotations,
} from "./metadata.js";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ToolInput = Record<string, unknown>;

type ApiToolDefinition = {
	name: string;
	title: string;
	description: string;
	method: HttpMethod;
	path: string;
	scopes?: string[];
	inputSchema?: z.ZodRawShape;
	pathParams?: string[];
	queryParams?: string[];
	bodyParam?: string;
	headerParams?: string[];
	auth?: boolean;
	annotations: ToolAnnotations;
};

const reportId = z.string().min(1).max(256).describe("Y2 report ID.");
const profileId = z.string().min(1).max(256).describe("Y2 profile ID.");
const webhookId = z.string().min(1).max(256).describe("Y2 webhook configuration ID.");
const subscriptionId = z.string().min(1).max(256).describe("Y2 subscription ID.");
const countryCode = z
	.string()
	.length(2)
	.describe("ISO 3166-1 alpha-2 country code, such as US, CN, or RU.");
const entityId = z.string().min(1).max(256).describe("Y2 intel entity ID.");
const incidentId = z.string().min(1).max(256).describe("Y2 intel incident ID.");
const nonce = z.string().min(1).max(512).describe("x402 payment authorization nonce.");
const projectId = z.string().min(1).max(256).describe("Y2 project ID.");
const automationId = z.string().min(1).max(256).describe("Y2 automation ID.");
const idempotencyKey = z
	.string()
	.min(8)
	.max(200)
	.regex(/^[A-Za-z0-9._:-]+$/)
	.describe("Unique key to deduplicate automation runs, such as a UUID.");

const stringFilter = (description: string) => z.string().min(1).max(512).optional().describe(description);
const boolFilter = (description: string) => z.boolean().optional().describe(description);
const numberFilter = (description: string, minimum?: number, maximum?: number) => {
	let schema = z.number();
	if (minimum !== undefined) schema = schema.min(minimum);
	if (maximum !== undefined) schema = schema.max(maximum);
	return schema.optional().describe(description);
};
const intFilter = (
	description: string,
	options: { minimum?: number; maximum?: number; defaultValue?: number } = {},
) => {
	let schema = z.number().int();
	if (options.minimum !== undefined) schema = schema.min(options.minimum);
	if (options.maximum !== undefined) schema = schema.max(options.maximum);
	const described = schema.describe(description);
	return options.defaultValue === undefined ? described.optional() : described.default(options.defaultValue);
};
const enumFilter = <T extends [string, ...string[]]>(values: T, description: string) =>
	z.enum(values).optional().describe(description);
const stringList = (description: string, maxItems = 24) =>
	z.array(z.string().min(1).max(128)).max(maxItems).optional().describe(description);
const jsonBody = (description: string) => z.record(z.unknown()).describe(description);

const sourceTypeValues: [string, ...string[]] = [
	"usgs",
	"rss",
	"acled",
	"gdelt",
	"gdacs",
	"eonet",
	"firms",
	"opensky",
	"wingbits",
	"usni",
	"polymarket",
	"kalshi",
	"urlhaus",
	"feodo",
	"y2_report",
	"manual",
	"fred",
	"yfinance",
	"eia",
];

const finintCategoryValues: [string, ...string[]] = [
	"equities",
	"volatility",
	"rates",
	"commodities",
	"energy",
	"crypto",
	"inflation",
	"labor",
	"money_supply",
];

const entityKindValues: [string, ...string[]] = [
	"person",
	"organization",
	"country",
	"region",
	"vessel",
	"aircraft",
	"facility",
	"asset",
	"indicator",
	"cve",
	"malware_family",
	"threat_actor",
	"vendor",
	"software",
	"ai_model",
	"api_service",
	"protocol",
];

const incidentCategoryValues: [string, ...string[]] = [
	"seismic",
	"conflict",
	"political",
	"economic",
	"weather",
	"health",
	"cyber",
	"maritime",
	"fire",
	"aviation",
	"other",
];

const priorityValues: [string, ...string[]] = ["low", "medium", "high", "critical"];
const severityValues: [string, ...string[]] = ["low", "medium", "high", "critical"];

const readTools: ApiToolDefinition[] = [
	{
		name: "y2_get_report_signals",
		title: "Get Report Signals",
		description: "Get emergent signals for one Y2 report. Requires reports:read.",
		method: "GET",
		path: "/reports/{reportId}/signals",
		scopes: ["reports:read"],
		inputSchema: { reportId },
		pathParams: ["reportId"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_report_graph",
		title: "Get Report Graph",
		description: "Get the ontology graph snapshot for one Y2 report. Requires reports:read.",
		method: "GET",
		path: "/reports/{reportId}/graph",
		scopes: ["reports:read"],
		inputSchema: { reportId },
		pathParams: ["reportId"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_report_audio",
		title: "Get Report Audio",
		description: "Get audio metadata for one Y2 report. Requires reports:audio.",
		method: "GET",
		path: "/reports/{reportId}/audio",
		scopes: ["reports:audio"],
		inputSchema: {
			reportId,
			redirect: boolFilter("If true, request a 302 redirect to the audio CDN URL."),
		},
		pathParams: ["reportId"],
		queryParams: ["redirect"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_report_text",
		title: "Get Report Text",
		description: "Get one Y2 report as plain text metadata. Requires reports:read.",
		method: "GET",
		path: "/reports/{reportId}/text",
		scopes: ["reports:read"],
		inputSchema: { reportId },
		pathParams: ["reportId"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_report_audio_text",
		title: "Get Report Audio Text",
		description: "Get text preprocessed for Y2 report text-to-speech. Requires reports:read.",
		method: "GET",
		path: "/reports/{reportId}/audio-text",
		scopes: ["reports:read"],
		inputSchema: { reportId },
		pathParams: ["reportId"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_profiles",
		title: "List Profiles",
		description: "List subscribed Y2 intelligence profiles. Requires profiles:read.",
		method: "GET",
		path: "/profiles",
		scopes: ["profiles:read"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_webhooks",
		title: "List Webhooks",
		description: "List Y2 webhook configurations. Requires webhooks:manage.",
		method: "GET",
		path: "/webhooks",
		scopes: ["webhooks:manage"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_recaps",
		title: "List News Recaps",
		description: "List AI-generated Y2 News recap summaries. Requires news:read.",
		method: "GET",
		path: "/news/recaps",
		scopes: ["news:read"],
		inputSchema: {
			topics: stringList("Optional Y2 news topics to filter, sent as comma-separated values.", 12),
			timeframe: stringFilter("Optional recap timeframe."),
		},
		queryParams: ["topics", "timeframe"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_feeds",
		title: "List News Feeds",
		description: "List available Y2 News feeds. Requires news:read.",
		method: "GET",
		path: "/news/feeds",
		scopes: ["news:read"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_osint_events",
		title: "List OSINT Events",
		description: "List Y2 Situation Room threat events. Requires osint:read.",
		method: "GET",
		path: "/osint/events",
		scopes: ["osint:read"],
		inputSchema: {
			category: stringFilter("Optional OSINT event category."),
			severity: stringFilter("Optional severity level."),
			limit: intFilter("Maximum events to return.", { minimum: 1, maximum: 200, defaultValue: 50 }),
		},
		queryParams: ["category", "severity", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_osint_map_events",
		title: "List OSINT Map Events",
		description: "List geolocated Y2 OSINT map events. Requires osint:read.",
		method: "GET",
		path: "/osint/map",
		scopes: ["osint:read"],
		inputSchema: {
			region: stringFilter("Optional geographic region."),
			limit: intFilter("Maximum events to return.", { minimum: 1, maximum: 500, defaultValue: 200 }),
		},
		queryParams: ["region", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_cii",
		title: "List Conflict Indicators",
		description: "List Conflict Indicators Index items. Requires osint:read.",
		method: "GET",
		path: "/osint/cii",
		scopes: ["osint:read"],
		inputSchema: {
			region: stringFilter("Optional geographic region."),
			category: stringFilter("Optional event category."),
			limit: intFilter("Maximum items to return.", { minimum: 1, maximum: 100, defaultValue: 50 }),
		},
		queryParams: ["region", "category", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_country_brief",
		title: "Get Country Brief",
		description: "Get an AI-generated country intelligence brief. Requires osint:read.",
		method: "GET",
		path: "/osint/countries/{countryCode}/brief",
		scopes: ["osint:read"],
		inputSchema: { countryCode },
		pathParams: ["countryCode"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_country_stock_index",
		title: "Get Country Stock Index",
		description: "Get country stock market index data. Requires osint:read.",
		method: "GET",
		path: "/osint/countries/{countryCode}/markets",
		scopes: ["osint:read"],
		inputSchema: { countryCode },
		pathParams: ["countryCode"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_country_predictions",
		title: "Get Country Predictions",
		description: "Get country-specific prediction markets. Requires osint:read.",
		method: "GET",
		path: "/osint/countries/{countryCode}/predictions",
		scopes: ["osint:read"],
		inputSchema: {
			countryCode,
			limit: intFilter("Maximum predictions to return.", {
				minimum: 1,
				maximum: 10,
				defaultValue: 3,
			}),
		},
		pathParams: ["countryCode"],
		queryParams: ["limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_country_news",
		title: "Get Country News",
		description: "Get country-specific news. Requires osint:read.",
		method: "GET",
		path: "/osint/countries/{countryCode}/news",
		scopes: ["osint:read"],
		inputSchema: {
			countryCode,
			limit: intFilter("Maximum news items to return.", {
				minimum: 1,
				maximum: 20,
				defaultValue: 8,
			}),
		},
		pathParams: ["countryCode"],
		queryParams: ["limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_country_cii",
		title: "Get Country Instability Index",
		description: "Get country instability index details. Requires osint:read.",
		method: "GET",
		path: "/osint/countries/{countryCode}/cii",
		scopes: ["osint:read"],
		inputSchema: { countryCode },
		pathParams: ["countryCode"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_military_posture",
		title: "List Military Posture",
		description: "List military posture by theater. Requires osint:read.",
		method: "GET",
		path: "/osint/military-posture",
		scopes: ["osint:read"],
		inputSchema: {
			limit: intFilter("Maximum items to return.", { minimum: 1, maximum: 50, defaultValue: 20 }),
		},
		queryParams: ["limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_aircraft",
		title: "List Aircraft",
		description: "List tracked military aircraft. Requires osint:read.",
		method: "GET",
		path: "/osint/aircraft",
		scopes: ["osint:read"],
		inputSchema: {
			theater: stringFilter('Optional theater ID, such as "iran", "taiwan", "blacksea", or "scs".'),
			limit: intFilter("Maximum aircraft to return.", {
				minimum: 1,
				maximum: 500,
				defaultValue: 100,
			}),
		},
		queryParams: ["theater", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_vessels",
		title: "List Vessels",
		description: "List naval vessel positions. Requires osint:read.",
		method: "GET",
		path: "/osint/vessels",
		scopes: ["osint:read"],
		inputSchema: {
			region: stringFilter("Optional region name."),
			limit: intFilter("Maximum vessels to return.", { minimum: 1, maximum: 200, defaultValue: 50 }),
		},
		queryParams: ["region", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_gps_jamming",
		title: "List GPS Jamming",
		description: "List GPS interference zones. Requires osint:read.",
		method: "GET",
		path: "/osint/gps-jamming",
		scopes: ["osint:read"],
		inputSchema: {
			severity: enumFilter(["low", "moderate", "severe", "critical"], "Optional interference severity."),
			limit: intFilter("Maximum zones to return.", { minimum: 1, maximum: 200, defaultValue: 50 }),
		},
		queryParams: ["severity", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_source_status",
		title: "List Source Status",
		description: "List Y2 OSINT data source health. Requires osint:read.",
		method: "GET",
		path: "/osint/sources/status",
		scopes: ["osint:read"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_cyber_threats",
		title: "List Cyber Threats",
		description: "List cyber threat indicators. Requires osint:read.",
		method: "GET",
		path: "/osint/cyber-threats",
		scopes: ["osint:read"],
		inputSchema: {
			severity: stringFilter("Optional severity level."),
			limit: intFilter("Maximum threats to return.", { minimum: 1, maximum: 200, defaultValue: 50 }),
		},
		queryParams: ["severity", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_prediction_markets",
		title: "List Prediction Markets",
		description: "List prediction markets. Requires osint:read.",
		method: "GET",
		path: "/osint/prediction-markets",
		scopes: ["osint:read"],
		inputSchema: {
			countryCode: countryCode.optional(),
			limit: intFilter("Maximum markets to return.", { minimum: 1, maximum: 100, defaultValue: 20 }),
		},
		queryParams: ["countryCode", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_y2_events",
		title: "List Y2 Events",
		description: "List events extracted from Y2 reports. Requires osint:read.",
		method: "GET",
		path: "/osint/y2-events",
		scopes: ["osint:read"],
		inputSchema: {
			category: stringFilter("Optional event category."),
			severity: stringFilter("Optional severity level."),
			countryCode: countryCode.optional(),
			limit: intFilter("Maximum events to return.", { minimum: 1, maximum: 200, defaultValue: 50 }),
		},
		queryParams: ["category", "severity", "countryCode", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_osint_regional_events",
		title: "List Regional OSINT Events",
		description: "List regional cross-source OSINT events with search and geospatial filters. Requires osint:read.",
		method: "GET",
		path: "/osint/regional",
		scopes: ["osint:read"],
		inputSchema: {
			q: stringFilter("Optional full-text search on title and description."),
			region: stringFilter("Optional geographic region."),
			countryCode: countryCode.optional(),
			sourceType: enumFilter(sourceTypeValues, "Optional source type filter."),
			category: stringFilter("Optional event category."),
			severity: stringFilter("Optional severity level."),
			bbox: stringFilter('Optional bounding box as "minLon,minLat,maxLon,maxLat".'),
			nearLat: numberFilter("Optional center latitude for radius filter.", -90, 90),
			nearLon: numberFilter("Optional center longitude for radius filter.", -180, 180),
			radiusKm: numberFilter("Optional radius in kilometers.", 0, 20_000),
			requireCoordinates: boolFilter("When true, only return rows with coordinates."),
			since: intFilter("Inclusive lower bound on eventTime in epoch milliseconds.", { minimum: 0 }),
			until: intFilter("Inclusive upper bound on eventTime in epoch milliseconds.", { minimum: 0 }),
			datetime: stringFilter(
				'Optional ISO 8601 datetime or interval, such as "2026-01-01T00:00:00Z/2026-01-02T00:00:00Z".',
			),
			limit: intFilter("Maximum events to return.", { minimum: 1, maximum: 200, defaultValue: 50 }),
		},
		queryParams: [
			"q",
			"region",
			"countryCode",
			"sourceType",
			"category",
			"severity",
			"bbox",
			"nearLat",
			"nearLon",
			"radiusKm",
			"requireCoordinates",
			"since",
			"until",
			"datetime",
			"limit",
		],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_finint_indicators",
		title: "List FinInt Indicators",
		description: "List financial intelligence indicators from OSINT. Requires osint:read.",
		method: "GET",
		path: "/osint/finint",
		scopes: ["osint:read"],
		inputSchema: {
			category: enumFilter(finintCategoryValues, "Optional indicator category."),
			source: enumFilter(["fred", "yfinance", "eia"], "Optional data source."),
			dimensionType: enumFilter(["facility", "rto", "port", "state"], "Optional dimension type."),
			limit: intFilter("Maximum indicators to return.", {
				minimum: 1,
				maximum: 100,
				defaultValue: 50,
			}),
		},
		queryParams: ["category", "source", "dimensionType", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_incidents_v2",
		title: "List Intel Incidents",
		description: "List ontology-clustered intel incidents. Requires intel:explorer, intel:finint, or intel:cyber.",
		method: "GET",
		path: "/api/v2/incidents",
		scopes: ["intel:explorer", "intel:finint", "intel:cyber"],
		inputSchema: {
			category: enumFilter(incidentCategoryValues, "Optional incident category."),
			severity: enumFilter(severityValues, "Optional severity."),
			status: enumFilter(["active", "resolved", "forecast"], "Optional lifecycle status."),
			sinceMs: intFilter("Lower bound on lastObservedAt as Unix milliseconds.", { minimum: 0 }),
			limit: intFilter("Maximum incidents to return.", {
				minimum: 1,
				maximum: 500,
				defaultValue: 50,
			}),
		},
		queryParams: ["category", "severity", "status", "sinceMs", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_incident_v2",
		title: "Get Intel Incident",
		description: "Get one ontology-clustered intel incident. Requires intel:explorer, intel:finint, or intel:cyber.",
		method: "GET",
		path: "/api/v2/incidents/{incidentId}",
		scopes: ["intel:explorer", "intel:finint", "intel:cyber"],
		inputSchema: { incidentId },
		pathParams: ["incidentId"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_entities_v2",
		title: "List Intel Entities",
		description: "List ontology-backed intel entities. Requires intel:explorer.",
		method: "GET",
		path: "/api/v2/entities",
		scopes: ["intel:explorer"],
		inputSchema: {
			kind: enumFilter(entityKindValues, "Optional entity kind."),
			q: stringFilter("Optional full-text search across canonicalName."),
			limit: intFilter("Maximum entities to return.", { minimum: 1, maximum: 500, defaultValue: 50 }),
		},
		queryParams: ["kind", "q", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_entity_v2",
		title: "Get Intel Entity",
		description: "Get one ontology-backed intel entity. Requires intel:explorer.",
		method: "GET",
		path: "/api/v2/entities/{entityId}",
		scopes: ["intel:explorer"],
		inputSchema: { entityId },
		pathParams: ["entityId"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_entity_graph_v2",
		title: "Get Entity Graph",
		description: "Traverse an intel entity relationship graph. Requires intel:explorer.",
		method: "GET",
		path: "/api/v2/entities/{entityId}/graph",
		scopes: ["intel:explorer"],
		inputSchema: {
			entityId,
			depth: intFilter("Maximum breadth-first traversal depth.", {
				minimum: 0,
				maximum: 3,
				defaultValue: 2,
			}),
			relationKinds: stringList("Optional relation kinds to traverse, sent as comma-separated values."),
		},
		pathParams: ["entityId"],
		queryParams: ["depth", "relationKinds"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_markets_v2",
		title: "List Intel Markets",
		description: "List ontology-backed intel markets. Requires intel:finint.",
		method: "GET",
		path: "/api/v2/markets",
		scopes: ["intel:finint"],
		inputSchema: {
			source: enumFilter(["y2", "polymarket", "kalshi", "manifold", "derived"], "Optional market source."),
			status: enumFilter(["open", "resolved", "cancelled"], "Optional lifecycle status."),
			limit: intFilter("Maximum markets to return.", { minimum: 1, maximum: 500, defaultValue: 50 }),
		},
		queryParams: ["source", "status", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_finint_intel_v2",
		title: "List FinInt Intel",
		description: "List dedicated financial intelligence indicators. Requires intel:finint.",
		method: "GET",
		path: "/api/v2/finint",
		scopes: ["intel:finint"],
		inputSchema: {
			dimensionType: enumFilter(["facility", "rto", "port", "state"], "Optional dimension type."),
			dimension: stringFilter("Optional exact dimension key, such as PJM, vogtle, or houston."),
			indicatorId: stringFilter("Optional exact indicator key, such as EIA:WTI or FRED:DGS10."),
			category: enumFilter(finintCategoryValues, "Optional indicator category."),
			source: enumFilter(["fred", "yfinance", "eia"], "Optional data source."),
			limit: intFilter("Maximum indicators to return.", {
				minimum: 1,
				maximum: 500,
				defaultValue: 100,
			}),
		},
		queryParams: ["dimensionType", "dimension", "indicatorId", "category", "source", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_signals_v2",
		title: "List Intel Signals",
		description: "List tagged emergent signals. Requires intel:explorer, intel:finint, or intel:cyber.",
		method: "GET",
		path: "/api/v2/signals",
		scopes: ["intel:explorer", "intel:finint", "intel:cyber"],
		inputSchema: {
			domain: enumFilter(
				[
					"cyber",
					"markets",
					"geopolitical",
					"operational",
					"supply_chain",
					"policy",
					"military",
					"technology",
					"other",
				],
				"Optional signal domain.",
			),
			actionType: enumFilter(
				[
					"invest",
					"patch",
					"upgrade",
					"strategy",
					"hedge",
					"monitor",
					"mitigate",
					"escalate",
					"defer",
					"allocate",
				],
				"Optional candidate action type.",
			),
			priority: enumFilter(priorityValues, "Optional priority."),
			subjectKey: stringFilter("Optional normalized subject key."),
			subjectKind: enumFilter(entityKindValues, "Optional ontology subject kind."),
			entityId: entityId.optional(),
			countryCode: countryCode.optional(),
			region: stringFilter("Optional region label."),
			visibility: enumFilter(["private", "workspace", "community", "global"], "Optional signal visibility."),
			q: stringFilter("Optional text search across signal fields."),
			sinceMs: intFilter("Lower bound on signal extraction timestamp as Unix milliseconds.", { minimum: 0 }),
			untilMs: intFilter("Upper bound on signal extraction timestamp as Unix milliseconds.", { minimum: 0 }),
			profileId: stringFilter("Optional profile ID filter."),
			reportId: stringFilter("Optional report ID filter."),
			limit: intFilter("Maximum signals to return.", { minimum: 1, maximum: 500, defaultValue: 50 }),
		},
		queryParams: [
			"domain",
			"actionType",
			"priority",
			"subjectKey",
			"subjectKind",
			"entityId",
			"countryCode",
			"region",
			"visibility",
			"q",
			"sinceMs",
			"untilMs",
			"profileId",
			"reportId",
			"limit",
		],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_cyber_graph_v2",
		title: "Get Cyber Graph",
		description: "Get the cyber entity graph. Requires intel:cyber.",
		method: "GET",
		path: "/api/v2/cyber/graph",
		scopes: ["intel:cyber"],
		inputSchema: {
			rootCveId: stringFilter("Optional root CVE entity ID."),
			rootActorId: stringFilter("Optional root threat actor entity ID."),
			rootMalwareFamilyId: stringFilter("Optional root malware family entity ID."),
			depth: intFilter("Maximum breadth-first traversal depth.", {
				minimum: 1,
				maximum: 2,
				defaultValue: 2,
			}),
		},
		queryParams: ["rootCveId", "rootActorId", "rootMalwareFamilyId", "depth"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_cves_v2",
		title: "List CVEs",
		description: "List CVE entities. Requires intel:cyber.",
		method: "GET",
		path: "/api/v2/cyber/cves",
		scopes: ["intel:cyber"],
		inputSchema: {
			q: stringFilter("Optional full-text search on canonicalName, such as CVE-YYYY-NNNN."),
			limit: intFilter("Maximum CVEs to return.", { minimum: 1, maximum: 500, defaultValue: 50 }),
		},
		queryParams: ["q", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_threat_actors_v2",
		title: "List Threat Actors",
		description: "List threat actor entities. Requires intel:cyber.",
		method: "GET",
		path: "/api/v2/cyber/actors",
		scopes: ["intel:cyber"],
		inputSchema: {
			q: stringFilter("Optional full-text search on canonicalName."),
			limit: intFilter("Maximum threat actors to return.", {
				minimum: 1,
				maximum: 500,
				defaultValue: 50,
			}),
		},
		queryParams: ["q", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_changes_v2",
		title: "List Intel Changes",
		description:
			"List incremental change events with a resumable watermark checkpoint. Requires intel:explorer, intel:finint, or intel:cyber.",
		method: "GET",
		path: "/api/v2/changes",
		scopes: ["intel:explorer", "intel:finint", "intel:cyber"],
		inputSchema: {
			watermark: stringFilter(
				"Optional exclusive checkpoint returned by an earlier response for incremental polling.",
			),
			limit: intFilter("Maximum change events to return.", {
				minimum: 1,
				maximum: 500,
				defaultValue: 100,
			}),
		},
		queryParams: ["watermark", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_retrieve_knowledge_v2",
		title: "Retrieve Global Knowledge",
		description:
			"Retrieve grounded Y2 global knowledge passages with canonical references. Requires intel:explorer.",
		method: "POST",
		path: "/api/v2/intel/knowledge/retrieve",
		scopes: ["intel:explorer"],
		inputSchema: {
			body: jsonBody("GlobalKnowledgeRetrievalRequest JSON body from the Y2 OpenAPI schema."),
		},
		bodyParam: "body",
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_projects",
		title: "List Projects",
		description: "List Y2 projects. Requires projects:read.",
		method: "GET",
		path: "/projects",
		scopes: ["projects:read"],
		inputSchema: {
			status: stringFilter("Optional project status filter."),
			limit: intFilter("Maximum projects to return.", { minimum: 1, maximum: 100, defaultValue: 20 }),
		},
		queryParams: ["status", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_project",
		title: "Get Project",
		description: "Get one Y2 project by ID. Requires projects:read.",
		method: "GET",
		path: "/projects/{projectId}",
		scopes: ["projects:read"],
		inputSchema: { projectId },
		pathParams: ["projectId"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_automations",
		title: "List Automations",
		description: "List Y2 automations. Requires automations:read.",
		method: "GET",
		path: "/automations",
		scopes: ["automations:read"],
		inputSchema: {
			projectId: projectId.optional().describe("Optional project ID filter."),
			status: stringFilter("Optional automation status filter."),
			limit: intFilter("Maximum automations to return.", {
				minimum: 1,
				maximum: 100,
				defaultValue: 20,
			}),
		},
		queryParams: ["projectId", "status", "limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_automation",
		title: "Get Automation",
		description: "Get one Y2 automation by ID. Requires automations:read.",
		method: "GET",
		path: "/automations/{automationId}",
		scopes: ["automations:read"],
		inputSchema: { automationId },
		pathParams: ["automationId"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_list_automation_runs",
		title: "List Automation Runs",
		description: "List runs for one Y2 automation. Requires automations:read.",
		method: "GET",
		path: "/automations/{automationId}/runs",
		scopes: ["automations:read"],
		inputSchema: {
			automationId,
			limit: intFilter("Maximum runs to return.", { minimum: 1, maximum: 100, defaultValue: 20 }),
		},
		pathParams: ["automationId"],
		queryParams: ["limit"],
		annotations: readOnlyExternalToolAnnotations,
	},
	{
		name: "y2_get_x402_receipt",
		title: "Get x402 Receipt",
		description: "Look up sanitized x402 payment receipt status by nonce. Does not require Y2_API_KEY.",
		method: "GET",
		path: "/x402/receipts/{nonce}",
		inputSchema: { nonce },
		pathParams: ["nonce"],
		auth: false,
		annotations: readOnlyExternalToolAnnotations,
	},
];

const writeTools: ApiToolDefinition[] = [
	{
		name: "y2_create_profile",
		title: "Create Profile",
		description: "Create a Y2 intelligence profile. Requires profiles:write and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "POST",
		path: "/profiles",
		scopes: ["profiles:write"],
		inputSchema: {
			body: jsonBody("ProfileCreateRequest JSON body from the Y2 OpenAPI schema."),
		},
		bodyParam: "body",
		annotations: additiveExternalToolAnnotations,
	},
	{
		name: "y2_update_profile",
		title: "Update Profile",
		description:
			"Fully update a Y2 intelligence profile. Requires profiles:write and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "PUT",
		path: "/profiles/{profileId}",
		scopes: ["profiles:write"],
		inputSchema: {
			profileId,
			body: jsonBody("ProfileUpdateRequest JSON body from the Y2 OpenAPI schema."),
		},
		pathParams: ["profileId"],
		bodyParam: "body",
		annotations: destructiveExternalToolAnnotations,
	},
	{
		name: "y2_patch_profile",
		title: "Patch Profile",
		description:
			"Partially update a Y2 intelligence profile. Requires profiles:write and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "PATCH",
		path: "/profiles/{profileId}",
		scopes: ["profiles:write"],
		inputSchema: {
			profileId,
			body: jsonBody("ProfileUpdateRequest JSON body from the Y2 OpenAPI schema."),
		},
		pathParams: ["profileId"],
		bodyParam: "body",
		annotations: destructiveExternalToolAnnotations,
	},
	{
		name: "y2_delete_profile",
		title: "Delete Profile",
		description: "Delete a Y2 intelligence profile. Requires profiles:write and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "DELETE",
		path: "/profiles/{profileId}",
		scopes: ["profiles:write"],
		inputSchema: { profileId },
		pathParams: ["profileId"],
		annotations: destructiveExternalToolAnnotations,
	},
	{
		name: "y2_create_webhook",
		title: "Create Webhook",
		description: "Create a Y2 webhook configuration. Requires webhooks:manage and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "POST",
		path: "/webhooks",
		scopes: ["webhooks:manage"],
		inputSchema: {
			body: jsonBody("WebhookCreateRequest JSON body from the Y2 OpenAPI schema."),
		},
		bodyParam: "body",
		annotations: additiveExternalToolAnnotations,
	},
	{
		name: "y2_update_webhook",
		title: "Update Webhook",
		description: "Update a Y2 webhook configuration. Requires webhooks:manage and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "PUT",
		path: "/webhooks/{webhookId}",
		scopes: ["webhooks:manage"],
		inputSchema: {
			webhookId,
			body: jsonBody("WebhookUpdateRequest JSON body from the Y2 OpenAPI schema."),
		},
		pathParams: ["webhookId"],
		bodyParam: "body",
		annotations: destructiveExternalToolAnnotations,
	},
	{
		name: "y2_delete_webhook",
		title: "Delete Webhook",
		description: "Delete a Y2 webhook configuration. Requires webhooks:manage and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "DELETE",
		path: "/webhooks/{webhookId}",
		scopes: ["webhooks:manage"],
		inputSchema: { webhookId },
		pathParams: ["webhookId"],
		annotations: destructiveExternalToolAnnotations,
	},
	{
		name: "y2_test_webhook",
		title: "Test Webhook",
		description: "Send a test request to a Y2 webhook endpoint. Requires webhooks:manage and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "POST",
		path: "/webhooks/{webhookId}/test",
		scopes: ["webhooks:manage"],
		inputSchema: { webhookId },
		pathParams: ["webhookId"],
		annotations: additiveExternalToolAnnotations,
	},
	{
		name: "y2_update_delivery",
		title: "Update Subscription Delivery",
		description:
			"Update delivery method for a Y2 subscription. Requires webhooks:manage and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "PATCH",
		path: "/subscriptions/{subscriptionId}/delivery",
		scopes: ["webhooks:manage"],
		inputSchema: {
			subscriptionId,
			body: jsonBody("DeliveryUpdateRequest JSON body from the Y2 OpenAPI schema."),
		},
		pathParams: ["subscriptionId"],
		bodyParam: "body",
		annotations: destructiveExternalToolAnnotations,
	},
	{
		name: "y2_create_project",
		title: "Create Project",
		description: "Create a Y2 project. Requires projects:write and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "POST",
		path: "/projects",
		scopes: ["projects:write"],
		inputSchema: {
			body: jsonBody("ProjectCreateRequest JSON body from the Y2 OpenAPI schema."),
		},
		bodyParam: "body",
		annotations: additiveExternalToolAnnotations,
	},
	{
		name: "y2_patch_project",
		title: "Patch Project",
		description: "Partially update a Y2 project. Requires projects:write and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "PATCH",
		path: "/projects/{projectId}",
		scopes: ["projects:write"],
		inputSchema: {
			projectId,
			body: jsonBody("ProjectPatchRequest JSON body from the Y2 OpenAPI schema."),
		},
		pathParams: ["projectId"],
		bodyParam: "body",
		annotations: destructiveExternalToolAnnotations,
	},
	{
		name: "y2_create_automation",
		title: "Create Automation",
		description: "Create a Y2 automation. Requires automations:write and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "POST",
		path: "/automations",
		scopes: ["automations:write"],
		inputSchema: {
			body: jsonBody("AutomationCreateRequest JSON body from the Y2 OpenAPI schema."),
		},
		bodyParam: "body",
		annotations: additiveExternalToolAnnotations,
	},
	{
		name: "y2_patch_automation",
		title: "Patch Automation",
		description: "Partially update a Y2 automation. Requires automations:write and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "PATCH",
		path: "/automations/{automationId}",
		scopes: ["automations:write"],
		inputSchema: {
			automationId,
			body: jsonBody("AutomationPatchRequest JSON body from the Y2 OpenAPI schema."),
		},
		pathParams: ["automationId"],
		bodyParam: "body",
		annotations: destructiveExternalToolAnnotations,
	},
	{
		name: "y2_run_automation",
		title: "Run Automation",
		description:
			"Trigger one Y2 automation run. Requires automations:write and Y2_MCP_ENABLE_WRITE_TOOLS=1.",
		method: "POST",
		path: "/automations/{automationId}/runs",
		scopes: ["automations:write"],
		inputSchema: { automationId, idempotencyKey },
		headerParams: ["idempotencyKey:Idempotency-Key"],
		pathParams: ["automationId"],
		annotations: additiveExternalToolAnnotations,
	},
];

function toApiPath(openApiPath: string): string {
	if (openApiPath.startsWith("/api/v2/") || openApiPath.startsWith("/x402/")) {
		return openApiPath;
	}
	return `/api/v1${openApiPath}`;
}

function appendDefinedQuery(query: Record<string, string | undefined>, name: string, value: unknown) {
	if (value === undefined || value === null) return;
	if (Array.isArray(value)) {
		if (value.length === 0) return;
		query[name] = value.map((entry) => String(entry)).join(",");
		return;
	}
	query[name] = String(value);
}

function buildOperation(operation: ApiToolDefinition, input: ToolInput): {
	path: string;
	query: Record<string, string | undefined>;
	headers: Record<string, string>;
} {
	let path = toApiPath(operation.path);
	for (const param of operation.pathParams ?? []) {
		const value = input[param];
		if (typeof value !== "string" || value.length === 0) {
			throw new Error(`Missing required path parameter: ${param}.`);
		}
		path = path.replace(`{${param}}`, encodeURIComponent(value));
	}

	const query: Record<string, string | undefined> = {};
	for (const param of operation.queryParams ?? []) {
		appendDefinedQuery(query, param, input[param]);
	}

	const headers: Record<string, string> = {};
	for (const entry of operation.headerParams ?? []) {
		const [param, headerName] = entry.includes(":") ? entry.split(":") : [entry, entry];
		const value = input[param];
		if (typeof value === "string" && value.length > 0) headers[headerName] = value;
	}

	return { path, query, headers };
}

async function formatResponse(response: Response, config: Y2McpConfig): Promise<string> {
	if (response.status >= 300 && response.status < 400) {
		return formatJson(
			{
				status: response.status,
				location: response.headers.get("location"),
			},
			config,
		);
	}

	const text = await response.text();
	if (!text) return formatJson({ status: response.status }, config);

	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("json")) {
		try {
			return formatJson(JSON.parse(text), config);
		} catch {
			return limitText(text, config.maxResponseChars);
		}
	}

	return limitText(text, config.maxResponseChars);
}

async function callApiTool(
	operation: ApiToolDefinition,
	client: Y2Client,
	config: Y2McpConfig,
	input: ToolInput,
) {
	const built = buildOperation(operation, input);
	const response = await client.request(built.path, {
		method: operation.method,
		query: built.query,
		headers: built.headers,
		auth: operation.auth,
		body: operation.bodyParam ? input[operation.bodyParam] : undefined,
	});

	return textResult(await formatResponse(response, config));
}

function registerApiTool(
	server: McpServer,
	client: Y2Client,
	config: Y2McpConfig,
	operation: ApiToolDefinition,
) {
	server.registerTool(
		operation.name,
		{
			title: operation.title,
			description: operation.description,
			inputSchema: operation.inputSchema,
			annotations: operation.annotations,
		},
		async (input) => {
			try {
				return await callApiTool(operation, client, config, input as ToolInput);
			} catch (error) {
				return errorResult(error, config);
			}
		},
	);
}

export function registerExpandedApiTools(server: McpServer, client: Y2Client, config: Y2McpConfig) {
	for (const operation of readTools) {
		registerApiTool(server, client, config, operation);
	}
	if (!config.enableWriteTools) return;
	for (const operation of writeTools) {
		registerApiTool(server, client, config, operation);
	}
}

export const expandedReadToolNames = readTools.map((tool) => tool.name);
export const expandedWriteToolNames = writeTools.map((tool) => tool.name);
