import {
	MAX_CURSOR_LENGTH,
	type NativeResult,
} from "../worker/presentation.js";

export const MAX_VISIBLE_ITEMS = 200;
export type ViewState = {
	result: NativeResult;
	query?: Record<string, unknown>;
	scopes: string[];
	priority: string;
};
const queryKeys: Record<string, readonly string[]> = {
	profile: ["cursor", "q", "limit"],
	report: ["cursor", "profileId", "limit"],
	signal: [
		"cursor",
		"q",
		"limit",
		"countryCode",
		"profileId",
		"reportId",
		"entityId",
		"domain",
		"priority",
		"sinceMs",
		"untilMs",
	],
	map: [
		"cursor",
		"q",
		"limit",
		"countryCode",
		"datetime",
		"severity",
		"category",
	],
	entity: ["cursor", "q", "limit"],
};
const pagingTools: Record<string, string> = {
	profile: "y2_list_profiles",
	report: "y2_list_reports",
	signal: "y2_list_signals_v2",
	map: "y2_query_map",
	entity: "y2_list_entities_v2",
};

export function parseViewMetadata(
	value: unknown,
	kind: string,
): Pick<ViewState, "query" | "scopes"> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return { scopes: [] };
	const metadata = value as Record<string, unknown>;
	const scopes = Array.isArray(metadata.grantedScopes)
		? metadata.grantedScopes
				.filter(
					(scope): scope is string =>
						typeof scope === "string" && scope.length < 80,
				)
				.slice(0, 12)
		: [];
	const input = metadata.query;
	if (
		!input ||
		typeof input !== "object" ||
		Array.isArray(input) ||
		!queryKeys[kind]
	)
		return { scopes };
	const query: Record<string, unknown> = {};
	for (const key of queryKeys[kind]) {
		const entry = (input as Record<string, unknown>)[key];
		if (entry === undefined) continue;
		if (
			typeof entry === "string" &&
			entry.length <= (key === "cursor" ? MAX_CURSOR_LENGTH : 256)
		)
			query[key] = entry;
		else if (typeof entry === "number" && Number.isFinite(entry) && entry >= 0)
			query[key] = entry;
		else return { scopes };
	}
	return { query, scopes };
}
export const mapCategories = [
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
] as const;
const timeRanges: Record<string, number> = { day: 24, week: 168, month: 720 };
export function mapFilterRequest(
	view: ViewState,
	filters: { category: string; severity: string; timeRange: string },
	now = Date.now(),
): { name: string; args: Record<string, unknown> } | null {
	if (
		view.result.kind !== "map" ||
		!view.query ||
		!view.scopes.includes("osint:read") ||
		(filters.category &&
			!mapCategories.some((category) => category === filters.category)) ||
		(filters.severity &&
			!["low", "medium", "high", "critical"].includes(filters.severity)) ||
		(filters.timeRange && !Object.hasOwn(timeRanges, filters.timeRange)) ||
		!Number.isFinite(now)
	)
		return null;
	const {
		cursor: _cursor,
		category: _category,
		severity: _severity,
		...args
	} = view.query;
	if (filters.category) args.category = filters.category;
	if (filters.severity) args.severity = filters.severity;
	const hours = timeRanges[filters.timeRange];
	if (hours)
		args.datetime = `${new Date(now - hours * 3_600_000).toISOString()}/${new Date(now).toISOString()}`;
	return { name: "y2_query_map", args };
}
export function querySummary(view: ViewState): string {
	if (!view.query) return "Filters are unavailable for this saved result.";
	const labels: Record<string, string> = {
		countryCode: "Country",
		q: "Search",
		domain: "Domain",
		category: "Category",
		severity: "Severity",
		priority: "Priority",
		profileId: "Profile",
		reportId: "Report",
		entityId: "Entity",
		datetime: "Event time",
		sinceMs: "Extracted from (UTC)",
		untilMs: "Extracted through (UTC)",
	};
	const parts = Object.entries(labels).flatMap(([key, label]) => {
		const value = view.query?.[key];
		if (value === undefined) return [];
		if (key === "sinceMs" || key === "untilMs") {
			if (
				typeof value !== "number" ||
				!Number.isFinite(new Date(value).getTime())
			)
				return [];
			return [`${label}: ${new Date(value).toISOString()}`];
		}
		return typeof value === "string" ? [`${label}: ${value}`] : [];
	});
	return parts.length ? parts.join(" · ") : "No additional query filters.";
}
export function pageRequest(
	view: ViewState,
): { name: string; args: Record<string, unknown> } | null {
	const name = pagingTools[view.result.kind];
	if (
		!name ||
		!view.query ||
		!view.result.hasMore ||
		!view.result.nextCursor ||
		view.result.items.length >= MAX_VISIBLE_ITEMS
	)
		return null;
	return { name, args: { ...view.query, cursor: view.result.nextCursor } };
}
export function mergePage(
	previous: NativeResult,
	next: NativeResult,
): NativeResult {
	if (
		previous.kind !== next.kind ||
		previous.workspaceName !== next.workspaceName
	)
		throw new Error("The result context changed.");
	const items = new Map(previous.items.map((item) => [item.id, item]));
	for (const item of next.items) items.set(item.id, item);
	return {
		...next,
		items: [...items.values()].slice(0, MAX_VISIBLE_ITEMS),
		hasMore: next.hasMore || items.size > MAX_VISIBLE_ITEMS,
	};
}
export function titleForKind(kind: string): string {
	return (
		(
			{
				map: "Map",
				signal: "Signals",
				profile: "Profiles",
				report: "Reports",
				entity: "Entities",
			} as Record<string, string>
		)[kind] ?? "Y2 Intel"
	);
}
export function timeLabel(
	value: string,
	context?: { locale?: string; timeZone?: string },
): string {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return "time unavailable";
	try {
		return date.toLocaleString(context?.locale, {
			timeZone: context?.timeZone,
		});
	} catch {
		return date.toISOString();
	}
}
export class RequestGate {
	private current?: AbortController;
	begin(): AbortController {
		this.invalidate();
		this.current = new AbortController();
		return this.current;
	}
	isCurrent(ticket: AbortController): boolean {
		return ticket === this.current && !ticket.signal.aborted;
	}
	invalidate(): void {
		this.current?.abort();
		this.current = undefined;
	}
}
