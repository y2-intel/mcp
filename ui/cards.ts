import { type NativeResult, safeUrl } from "../worker/presentation";
import { timeLabel } from "./view-state";

type CardActions = {
	canReadReports: boolean;
	context?: { locale?: string; timeZone?: string };
	openLink: (url: string) => Promise<void>;
	call: (name: string, args: Record<string, unknown>) => Promise<void>;
	error: (message: string) => void;
};
function text(tag: string, value: string, parent: HTMLElement): HTMLElement {
	const child = document.createElement(tag);
	child.textContent = value;
	parent.append(child);
	return child;
}
function button(
	label: string,
	action: () => Promise<unknown>,
	error: CardActions["error"],
	tool = false,
): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.textContent = label;
	if (tool) button.dataset.toolAction = "true";
	button.onclick = () => {
		button.disabled = true;
		button.setAttribute("aria-busy", "true");
		void action()
			.catch(() =>
				error("This action is unavailable. Try again from your assistant."),
			)
			.finally(() => {
				button.disabled = false;
				button.setAttribute("aria-busy", "false");
			});
	};
	return button;
}
export function renderCards(
	items: NativeResult["items"],
	actions: CardActions,
): HTMLElement[] {
	return items.map((item) => {
		const card = document.createElement("article");
		card.id = `item-${item.id}`;
		card.tabIndex = -1;
		const heading = document.createElement("div");
		heading.className = "card-heading";
		text("h2", item.title, heading);
		if (item.priority)
			text("span", item.priority, heading).className = "priority";
		card.append(heading);
		const summaryTruncated = item.summary.length > 220;
		if (item.summary)
			text(
				"p",
				summaryTruncated
					? `${item.summary.slice(0, 217).trimEnd()}…`
					: item.summary,
				card,
			).className = "card-summary";
		const details = document.createElement("details");
		details.className = "card-details";
		const sources = item.sources.filter((source) => safeUrl(source.url));
		text(
			"summary",
			sources.length
				? `Details · ${sources.length} source${sources.length === 1 ? "" : "s"}`
				: "Details",
			details,
		);
		if (summaryTruncated) text("p", item.summary, details);
		const confidence =
			item.confidence === null
				? "Confidence unavailable"
				: `Confidence ${Math.round(item.confidence * 100)}%`;
		text(
			"small",
			[item.kind, item.domain, item.priority, confidence]
				.filter(Boolean)
				.join(" · "),
			details,
		);
		if (item.subjects?.length)
			text(
				"p",
				`Subjects: ${item.subjects.map((subject) => `${subject.label} (${subject.kind})`).join(", ")}`,
				details,
			).className = "muted";
		if (item.category || item.sourceType)
			text(
				"p",
				[
					item.category && `Category: ${item.category}`,
					item.sourceType && `Source: ${item.sourceType}`,
				]
					.filter(Boolean)
					.join(" · "),
				details,
			).className = "muted";
		if (item.kind === "profile") {
			const profileDetails = [
				item.status && `Status: ${item.status}`,
				item.frequency && `Frequency: ${item.frequency}`,
			].filter(Boolean);
			if (profileDetails.length)
				text("p", profileDetails.join(" · "), details).className = "muted";
			if (item.tags?.length)
				text("p", `Tags: ${item.tags.join(", ")}`, details).className = "muted";
			if (item.lastDeliveredAt)
				text(
					"p",
					`Last delivered: ${timeLabel(item.lastDeliveredAt, actions.context)}`,
					details,
				).className = "muted";
		}
		if (item.observedAt)
			text(
				"p",
				`Observed: ${timeLabel(item.observedAt, actions.context)}`,
				details,
			).className = "muted";
		if (item.kind === "entity") {
			if (item.entityType)
				text("p", `Type: ${item.entityType}`, details).className = "muted";
			if (item.aliases?.length)
				text(
					"p",
					`Also known as: ${item.aliases.join(", ")}`,
					details,
				).className = "muted";
		}
		if (item.timestamp) {
			const basis =
				(
					{
						occurredAt: "Occurred",
						publishedAt: "Published",
						generatedAt: "Generated",
						updatedAt: "Updated",
						createdAt: "Created",
						extractedAt: "Extracted",
						eventTimeISO: "Occurred",
					} as Record<string, string>
				)[item.timestampBasis] ?? item.timestampBasis;
			text(
				"p",
				`${basis}: ${timeLabel(item.timestamp, actions.context)}`,
				details,
			).className = "muted";
		}
		if (item.kind === "map" && !item.coordinates)
			text(
				"p",
				"Location unavailable; this event is listed without a map point.",
				card,
			).className = "muted";
		if (item.content) {
			const report = document.createElement("details");
			text(
				"summary",
				item.contentTruncated ? "Report excerpt" : "Report text",
				report,
			);
			text("pre", item.content, report).tabIndex = 0;
			card.append(report);
		}
		const sourceLinks = document.createElement("div");
		sourceLinks.className = "actions";
		for (const source of sources) {
			const url = safeUrl(source.url);
			if (!url) continue;
			const link = button(
				source.title ?? new URL(url).hostname,
				() => actions.openLink(url),
				actions.error,
			);
			link.title = new URL(url).hostname;
			sourceLinks.append(link);
		}
		if (sourceLinks.childElementCount) details.append(sourceLinks);
		card.append(details);
		const links = document.createElement("div");
		links.className = "actions";
		const appUrl = safeUrl(item.url);
		if (
			["profile", "report", "entity"].includes(item.kind) &&
			appUrl &&
			new URL(appUrl).origin === "https://y2.dev" &&
			new URL(appUrl).pathname.startsWith("/app/connected/")
		)
			links.append(
				button("Open in Y2", () => actions.openLink(appUrl), actions.error),
			);
		if (actions.canReadReports && item.kind === "profile")
			links.append(
				button(
					"Recent reports",
					() =>
						actions.call("y2_list_reports", { profileId: item.id, limit: 5 }),
					actions.error,
					true,
				),
			);
		if (actions.canReadReports && item.kind === "report" && !item.content)
			links.append(
				button(
					"Read report",
					() => actions.call("y2_get_report", { reportId: item.id }),
					actions.error,
					true,
				),
			);
		if (links.childElementCount) card.append(links);
		return card;
	});
}
