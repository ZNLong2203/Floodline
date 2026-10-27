// MapLibre v6 finds its worker next to its own module URL, which breaks once Vite
// pre-bundles or fingerprints it. Point it at the worker file explicitly; Vite
// serves it in dev and emits it as an asset in the build.
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(workerUrl);
