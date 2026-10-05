import {
	App,
	applyDocumentTheme,
	applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { type NativeResult, resultSchema } from "../worker/presentation";
import { renderCards } from "./cards";
import { IntelligenceMap } from "./map";
import {
	MAX_VISIBLE_ITEMS,
	mapCategories,
	mapFilterRequest,
	mergePage,
	pageRequest,
	parseViewMetadata,
	querySummary,
	RequestGate,
	timeLabel,
	titleForKind,
	type ViewState,
} from "./view-state";
import "./style.css";

const app = new App(
	{ name: "Y2 Intel", version: "0.3.0" },
	{ availableDisplayModes: ["inline", "fullscreen"] },
	{ strict: true },
);
function element<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id);
	if (!el) throw new Error(`Missing element: ${id}`);
	return el as T;
}
const status = element("status");
const items = element("items");
const more = element<HTMLButtonElement>("more");
const back = element<HTMLButtonElement>("back");
const priority = element<HTMLSelectElement>("priority");
const fullscreen = element<HTMLButtonElement>("fullscreen");
const mapFilters = element<HTMLFormElement>("map-filters");
const category = element<HTMLSelectElement>("category");
const severity = element<HTMLSelectElement>("severity");
const timeRange = element<HTMLSelectElement>("time-range");
for (const value of mapCategories) {
	const option = document.createElement("option");
	option.value = value;
	option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
	category.append(option);
}
const requests = new RequestGate();
const map = new IntelligenceMap(element("map"), element("legend"), (id) => {
	const card = document.getElementById(`item-${id}`);
	const details = card?.querySelector<HTMLDetailsElement>(".card-details");
	if (details) details.open = true;
	card?.scrollIntoView({ block: "nearest", behavior: "instant" });
	card?.focus({ preventScroll: true });
});
const history: ViewState[] = [];
let view: ViewState | undefined;
let loading = false;
let connected = false;
let disposed = false;
let displayMode: "inline" | "fullscreen" | "pip" = "inline";

function setLoading(value: boolean) {
	loading = value;
	items.setAttribute("aria-busy", String(value));
	const toolsAvailable =
		connected && Boolean(app.getHostCapabilities()?.serverTools);
	more.disabled = value || !toolsAvailable;
	for (const control of mapFilters.querySelectorAll<
		HTMLButtonElement | HTMLSelectElement
	>("button,select"))
		control.disabled = value || !toolsAvailable;
	for (const control of items.querySelectorAll<HTMLButtonElement>(
		"[data-tool-action]",
	))
		control.disabled = value || !toolsAvailable;
}
function metadataFor(
	result: NativeResult,
	metadata: unknown,
	fallbackQuery?: Record<string, unknown>,
): ViewState {
	const parsed = parseViewMetadata(metadata, result.kind);
	return {
		result,
		query: parsed.query ?? fallbackQuery,
		scopes: parsed.scopes,
		priority: "",
	};
}
async function call(
	name: string,
	args: Record<string, unknown>,
	append = false,
) {
	if (loading || !connected || disposed) return;
	const currentView = view;
	const ticket = requests.begin();
	setLoading(true);
	status.textContent = "Loading intelligence…";
	try {
		const response = await app.callServerTool(
			{ name, arguments: args },
			{ signal: ticket.signal, timeout: 30_000 },
		);
		if (!requests.isCurrent(ticket) || disposed) return;
		if (response.isError) throw new Error("Tool rejected");
		const result = resultSchema.parse(response.structuredContent);
		const next = metadataFor(result, response._meta, args);
		if (append && currentView) {
			next.result = mergePage(currentView.result, result);
			next.priority = currentView.priority;
		} else if (currentView) {
			history.push(currentView);
			if (history.length > 10) history.shift();
		}
		view = next;
		render();
	} catch {
		if (requests.isCurrent(ticket) && !disposed)
			status.textContent =
				"Intelligence could not be loaded. Check the connection’s permissions or retry from your assistant.";
	} finally {
		if (requests.isCurrent(ticket) && !disposed) setLoading(false);
	}
}
function render() {
	if (!view || disposed) return;
	const { result } = view;
	priority.value = view.priority;
	element("workspace").textContent = `Workspace: ${result.workspaceName}`;
	element("title").textContent = titleForKind(result.kind);
	element("freshness").textContent =
		`Retrieved ${timeLabel(result.retrievedAt, app.getHostContext())}`;
	element("notice").textContent = result.notice;
	element("query").textContent = querySummary(view);
	element("controls").hidden = false;
	element("options").hidden = false;
	mapFilters.hidden =
		result.kind !== "map" || !view.query || !view.scopes.includes("osint:read");
	category.value =
		typeof view.query?.category === "string" ? view.query.category : "";
	severity.value =
		typeof view.query?.severity === "string" ? view.query.severity : "";
	timeRange.value = "";
	element("priority-control").hidden =
		result.kind !== "signal" && result.kind !== "map";
	back.hidden = history.length === 0;
	const filtered = result.items.filter(
		(item) => !view?.priority || item.priority === view.priority,
	);
	const paging = pageRequest(view);
	const capped = result.hasMore && result.items.length >= MAX_VISIBLE_ITEMS;
	const count = `${filtered.length} result${filtered.length === 1 ? "" : "s"}`;
	status.textContent = filtered.length
		? count
		: "No matching intelligence is available in the loaded results.";
	if (capped)
		status.textContent += ` · Showing up to ${MAX_VISIBLE_ITEMS} loaded results. Ask your assistant to narrow the query.`;
	else if (result.hasMore)
		status.textContent += paging
			? " · More available"
			: " · Ask your assistant for the next page.";
	items.replaceChildren(
		...renderCards(filtered, {
			canReadReports:
				connected &&
				Boolean(app.getHostCapabilities()?.serverTools) &&
				view.scopes.includes("reports:read"),
			context: app.getHostContext(),
			openLink: async (url) => {
				await app.openLink({ url });
			},
			call,
			error: (message) => {
				status.textContent = message;
			},
		}),
	);
	more.hidden = !paging;
	setLoading(loading);
	if (result.kind === "map") void map.update(filtered);
	else map.clear();
}
function syncHostContext() {
	const context = app.getHostContext();
	if (context?.theme) applyDocumentTheme(context.theme);
	if (context?.styles?.variables)
		applyHostStyleVariables(context.styles.variables);
	if (context?.displayMode) displayMode = context.displayMode;
	applyDisplayMode();
	map.resize();
	if (view) {
		element("freshness").textContent =
			`Retrieved ${timeLabel(view.result.retrievedAt, context)}`;
	}
}
function applyDisplayMode() {
	document.documentElement.dataset.displayMode = displayMode;
	const requestedMode = displayMode === "fullscreen" ? "inline" : "fullscreen";
	const context = app.getHostContext();
	fullscreen.hidden = !context?.availableDisplayModes?.includes(requestedMode);
	fullscreen.textContent = requestedMode === "inline" ? "Collapse" : "Expand";
}
priority.onchange = () => {
	if (view) view = { ...view, priority: priority.value };
	render();
};
more.onclick = () => {
	const page = view && pageRequest(view);
	if (page) void call(page.name, page.args, true);
};
mapFilters.onsubmit = (event) => {
	event.preventDefault();
	const request =
		view &&
		mapFilterRequest(view, {
			category: category.value,
			severity: severity.value,
			timeRange: timeRange.value,
		});
	if (request) void call(request.name, request.args);
};
back.onclick = () => {
	const previous = history.pop();
	if (!previous) return;
	requests.invalidate();
	setLoading(false);
	view = { ...previous, scopes: view?.scopes ?? [] };
	render();
	element("title").focus();
};
fullscreen.onclick = () => {
	const mode = displayMode === "fullscreen" ? "inline" : "fullscreen";
	fullscreen.disabled = true;
	void app
		.requestDisplayMode({ mode })
		.then((response) => {
			displayMode = response.mode;
			applyDisplayMode();
			requestAnimationFrame(() => map.resize());
		})
		.catch(() => {
			status.textContent = "Expanded view is unavailable in this host.";
		})
		.finally(() => {
			fullscreen.disabled = false;
		});
};
element<HTMLButtonElement>("open-y2").onclick = () => {
	void app.openLink({ url: "https://y2.dev/app" }).catch(() => {
		status.textContent =
			"This host cannot open links. Visit y2.dev to open your workspace.";
	});
};
function clearView() {
	requests.invalidate();
	history.length = 0;
	view = undefined;
	items.replaceChildren();
	map.clear();
	element("controls").hidden = true;
	element<HTMLDetailsElement>("options").open = false;
	element("options").hidden = true;
	mapFilters.hidden = true;
	more.hidden = true;
	element("workspace").textContent = "";
	element("title").textContent = "Intelligence";
	element("query").textContent = "";
	element("freshness").textContent = "";
	element("notice").textContent = "";
}
app.addEventListener("toolinput", () => {
	if (disposed) return;
	clearView();
	setLoading(true);
	status.textContent = "Loading authorized intelligence…";
});
app.addEventListener("toolresult", (params) => {
	requests.invalidate();
	setLoading(false);
	if (disposed) return;
	if (params.isError) {
		clearView();
		status.textContent =
			"The requested intelligence is unavailable. Retry from your assistant.";
		return;
	}
	const parsed = resultSchema.safeParse(params.structuredContent);
	if (!parsed.success) {
		clearView();
		status.textContent = "This response could not be displayed.";
		return;
	}
	history.length = 0;
	view = metadataFor(parsed.data, params._meta);
	render();
});
app.addEventListener("toolcancelled", () => {
	if (disposed) return;
	requests.invalidate();
	setLoading(false);
	status.textContent =
		"The request was cancelled. Ask your assistant to try again.";
});
app.addEventListener("hostcontextchanged", syncHostContext);
app.onteardown = async () => {
	disposed = true;
	requests.invalidate();
	map.dispose();
	return {};
};
void app
	.connect()
	.then(() => {
		if (disposed) return;
		connected = true;
		element<HTMLButtonElement>("open-y2").disabled =
			!app.getHostCapabilities()?.openLinks;
		syncHostContext();
		if (view) render();
	})
	.catch(() => {
		status.textContent =
			"Open Y2 Intel from a supported assistant to view your intelligence.";
	});
