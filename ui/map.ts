import type { FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { NativeResult } from "../worker/presentation";

type MapInstance = {
	map: MapLibreMap;
	ready: Promise<void>;
	cancel: AbortController;
};
const LEGEND =
	"Coral: critical · Amber: high · Teal: other · Violet: grouped events. Select a group to zoom. Country outlines: Natural Earth. Events and sources below.";
const MAP_UNAVAILABLE =
	"The interactive map is unavailable in this host. The event list contains the same results and sources.";
function waitForMap(map: MapLibreMap, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout);
			map.off("load", loaded);
			map.off("error", failed);
			signal.removeEventListener("abort", aborted);
		};
		const loaded = () => {
			cleanup();
			resolve();
		};
		const failed = () => {
			cleanup();
			reject(new Error("Map unavailable"));
		};
		const aborted = () => {
			cleanup();
			reject(new Error("Map closed"));
		};
		const timeout = setTimeout(failed, 10_000);
		map.once("load", loaded);
		map.once("error", failed);
		signal.addEventListener("abort", aborted, { once: true });
		if (signal.aborted) aborted();
	});
}
export class IntelligenceMap {
	private instance?: MapInstance;
	private revision = 0;
	private disposed = false;
	private resizeObserver: ResizeObserver;
	constructor(
		private container: HTMLElement,
		private legend: HTMLElement,
		private selectItem: (id: string) => void,
	) {
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(container);
	}
	resize(): void {
		this.instance?.map.resize();
	}
	clear(): void {
		this.revision++;
		this.instance?.cancel.abort();
		this.instance?.map.remove();
		this.instance = undefined;
		this.container.hidden = true;
		this.container.setAttribute("aria-busy", "false");
		this.legend.hidden = true;
	}
	dispose(): void {
		this.disposed = true;
		this.clear();
		this.resizeObserver.disconnect();
	}
	async update(items: NativeResult["items"]): Promise<void> {
		if (this.disposed) return;
		const revision = ++this.revision;
		const active = () => !this.disposed && revision === this.revision;
		this.container.hidden = false;
		this.container.setAttribute("aria-busy", "true");
		this.legend.hidden = false;
		this.legend.textContent =
			"Loading the map… The event list is available below.";
		try {
			const { maplibre, workerUrl } = await import("./map-runtime");
			if (!active()) return;
			maplibre.setWorkerUrl(workerUrl);
			maplibre.setWorkerCount(1);
			const geojson: FeatureCollection<Point> = {
				type: "FeatureCollection",
				features: items.flatMap((item) =>
					item.coordinates
						? [
								{
									type: "Feature" as const,
									geometry: {
										type: "Point" as const,
										coordinates: item.coordinates,
									},
									properties: {
										id: item.id,
										title: item.title,
										summary: item.summary,
										priority: item.priority,
									},
								},
							]
						: [],
				),
			};
			let instance = this.instance;
			if (!instance) {
				const map = new maplibre.Map({
					container: this.container,
					center: [0, 20],
					zoom: 1,
					attributionControl: false,
					style: {
						version: 8,
						sources: {
							countries: {
								type: "geojson",
								data: new URL(
									"world.geojson",
									new URL(import.meta.env.BASE_URL, window.location.href),
								).href,
							},
							events: {
								type: "geojson",
								data: geojson,
								cluster: true,
								clusterMaxZoom: 12,
								clusterRadius: 45,
							},
						},
						layers: [
							{
								id: "ocean",
								type: "background",
								paint: { "background-color": "#080808" },
							},
							{
								id: "land",
								type: "fill",
								source: "countries",
								paint: {
									"fill-color": "#292929",
									"fill-outline-color": "#9e9e9e",
								},
							},
							{
								id: "clusters",
								type: "circle",
								source: "events",
								filter: ["has", "point_count"],
								paint: {
									"circle-radius": [
										"step",
										["get", "point_count"],
										14,
										10,
										20,
										50,
										26,
									],
									"circle-color": "#a794ee",
									"circle-stroke-width": 2,
									"circle-stroke-color": "#ffffff",
								},
							},
							{
								id: "events",
								type: "circle",
								source: "events",
								filter: ["!", ["has", "point_count"]],
								paint: {
									"circle-radius": 6,
									"circle-color": [
										"match",
										["get", "priority"],
										"critical",
										"#ff716b",
										"high",
										"#ffbe76",
										"#55dec2",
									],
									"circle-stroke-width": 1.5,
									"circle-stroke-color": "#ffffff",
								},
							},
						],
					},
				});
				const cancel = new AbortController();
				instance = { map, cancel, ready: waitForMap(map, cancel.signal) };
				this.instance = instance;
				// A synchronous control setup error can happen before the awaited load below.
				void instance.ready.catch(() => undefined);
				map.addControl(
					new maplibre.NavigationControl({ showCompass: false }),
					"top-right",
				);
				map.addControl(
					new maplibre.AttributionControl({
						customAttribution: "Natural Earth · Public domain",
					}),
				);
				map
					.getCanvas()
					.setAttribute(
						"aria-label",
						"Public intelligence event map. Use arrow keys to pan and plus or minus to zoom.",
					);
				for (const layer of ["clusters", "events"]) {
					map.on("mouseenter", layer, () => {
						map.getCanvas().style.cursor = "pointer";
					});
					map.on("mouseleave", layer, () => {
						map.getCanvas().style.cursor = "";
					});
				}
				map.on("click", "clusters", (event) => {
					const feature = event.features?.[0];
					const clusterId = feature?.properties?.cluster_id;
					if (
						feature?.geometry.type !== "Point" ||
						typeof clusterId !== "number"
					)
						return;
					const center = feature.geometry.coordinates as [number, number];
					const atRevision = this.revision;
					void (map.getSource("events") as GeoJSONSource)
						.getClusterExpansionZoom(clusterId)
						.then((zoom) => {
							if (this.instance?.map === map && this.revision === atRevision)
								map.jumpTo({ center, zoom });
						})
						.catch(() => {
							if (this.instance?.map === map)
								this.legend.textContent =
									"The group could not be expanded. Use the zoom controls or event list.";
						});
				});
				map.on("click", "events", (event) => {
					const feature = event.features?.[0];
					if (feature?.geometry.type !== "Point") return;
					const content = document.createElement("div");
					const title = document.createElement("strong");
					title.textContent = String(feature.properties?.title ?? "Event");
					const summary = document.createElement("p");
					summary.textContent = String(feature.properties?.summary ?? "");
					content.append(title, summary);
					const viewDetails = document.createElement("button");
					viewDetails.type = "button";
					viewDetails.textContent = "Event details and sources";
					viewDetails.onclick = () =>
						this.selectItem(String(feature.properties?.id ?? ""));
					content.append(viewDetails);
					new maplibre.Popup()
						.setLngLat(feature.geometry.coordinates as [number, number])
						.setDOMContent(content)
						.addTo(map);
				});
			}
			await instance.ready;
			if (!active() || this.instance !== instance) return;
			(instance.map.getSource("events") as GeoJSONSource).setData(geojson);
			if (geojson.features.length) {
				const bounds = new maplibre.LngLatBounds();
				for (const feature of geojson.features)
					bounds.extend(feature.geometry.coordinates as [number, number]);
				instance.map.fitBounds(bounds, {
					padding: 45,
					// The 110m country basemap needs regional context; user zoom remains unrestricted.
					maxZoom: 2.5,
					duration: 0,
				});
			}
			this.container.setAttribute("aria-busy", "false");
			this.legend.textContent = LEGEND;
			instance.map.resize();
		} catch {
			if (!active()) return;
			this.clear();
			this.legend.hidden = false;
			this.legend.textContent = MAP_UNAVAILABLE;
		}
	}
}
