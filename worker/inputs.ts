import { z } from "zod";
import { MAX_CURSOR_LENGTH } from "./presentation";

export function publicId(prefix: "prf" | "rpt" | "ent") {
	return z
		.string()
		.regex(new RegExp(`^${prefix}_[a-f0-9]{24}$`))
		.describe("Public Y2 ID returned by a prior tool. Never invent an ID.");
}
export const cursor = z.string().max(MAX_CURSOR_LENGTH).optional();
export const q = z.string().trim().min(1).max(200).optional();
export const limit = z.number().int().min(1).max(50).default(20);
const instant = z.iso.datetime({ offset: true });
function validEventTime(value: string): boolean {
	const parts = value.split("/");
	if (parts.length === 1) return instant.safeParse(value).success;
	if (parts.length !== 2) return false;
	const [start, end] = parts;
	if (start === ".." && end === "..") return false;
	if (start !== ".." && !instant.safeParse(start).success) return false;
	if (end !== ".." && !instant.safeParse(end).success) return false;
	return start === ".." || end === ".." || Date.parse(start) <= Date.parse(end);
}
const countryCode = z
	.string()
	.regex(/^[A-Z]{2}$/)
	.optional()
	.describe("Public geographic area, ISO 3166-1 alpha-2 country code. Not the user's location.");
const domains = [
	"cyber",
	"markets",
	"geopolitical",
	"operational",
	"supply_chain",
	"policy",
	"military",
	"technology",
	"other",
] as const;
export const signalsInput = z
	.object({
		cursor,
		q,
		limit,
		countryCode,
		profileId: publicId("prf").optional(),
		reportId: publicId("rpt").optional(),
		entityId: publicId("ent").optional(),
		domain: z.enum(domains).optional(),
		priority: z.enum(["low", "medium", "high", "critical"]).optional(),
		sinceMs: z
			.number()
			.int()
			.nonnegative()
			.max(Number.MAX_SAFE_INTEGER)
			.optional()
			.describe("Signal extraction timestamp lower bound in milliseconds, not publication time."),
		untilMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
	})
	.strict();
export const mapInput = z
	.object({
		countryCode,
		q,
		cursor,
		limit,
		datetime: z
			.string()
			.min(1)
			.max(160)
			.refine(validEventTime, "Use an RFC 3339 instant or an ordered start/end interval.")
			.optional()
			.describe(
				"Event-time RFC 3339 instant or inclusive start/end interval; '..' opens one boundary.",
			),
		severity: z.enum(["low", "medium", "high", "critical"]).optional(),
		category: z
			.enum([
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
			])
			.optional(),
	})
	.strict();
export const profileInput = z.object({ profileId: publicId("prf") }).strict();
export function domainScopes(domain: string): string[] {
	return domain === "cyber" || domain === "technology"
		? ["intel:cyber", "intel:explorer"]
		: domain === "markets" || domain === "supply_chain"
			? ["intel:finint", "intel:explorer"]
			: ["intel:explorer"];
}
export function allowedDomains(scopes: string[]): string[] {
	return domains.filter((domain) => domainScopes(domain).some((scope) => scopes.includes(scope)));
}
