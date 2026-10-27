import type { Map as MLMap, StyleSpecification } from "maplibre-gl";
import type { Theme } from "./theme";

/**
 * Basemap. CARTO's raster CDN (basemaps.cartocdn.com) now answers every tile with an
 * "API KEY REQUIRED" placeholder, so the default is OpenFreeMap: free, keyless vector
 * tiles from OpenStreetMap, with Vietnamese street names. Set VITE_BASEMAP=carto to
 * go back to CARTO raster tiles once you have access.
 */
const KIND: "openfreemap" | "carto" = import.meta.env.VITE_BASEMAP === "carto" ? "carto" : "openfreemap";

const CARTO_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';

function carto(theme: Theme): StyleSpecification {
  const style = theme === "dark" ? "dark_all" : "voyager";
  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}.png`),
        tileSize: 256,
        attribution: CARTO_ATTRIBUTION,
        maxzoom: 20,
      },
    },
    layers: [{ id: "carto", type: "raster", source: "carto" }],
  };
}

export function basemapStyle(theme: Theme): string | StyleSpecification {
  if (KIND === "carto") return carto(theme);
  return `https://tiles.openfreemap.org/styles/${theme === "dark" ? "dark" : "positron"}`;
}

/**
 * OpenFreeMap styles label streets with name:latin / name:en, so some Huế streets show
 * as "Tran Hung Dao Street". Coordinators and residents read the local names; prefer
 * the OSM `name` tag (Vietnamese, with diacritics) everywhere.
 */
export function localiseLabels(map: MLMap): void {
  if (KIND !== "openfreemap") return;
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol") continue;
    const field = map.getLayoutProperty(layer.id, "text-field");
    if (field == null) continue;
    if (!JSON.stringify(field).includes("name")) continue;
    map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name"], ["get", "name:latin"], ["get", "name_en"]]);
  }
}

/** Start the compact attribution collapsed; it still opens with the (i) button. */
export function collapseAttribution(container: HTMLElement): void {
  container.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
}
