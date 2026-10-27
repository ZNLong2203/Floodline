import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/console.css";
import "./styles/report.css";

import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

const Console = lazy(() => import("./console/Console"));
const ReportPage = lazy(() => import("./report/ReportPage"));
const AttributionPage = lazy(() => import("./AttributionPage"));

// Plain pathname routing. FastAPI serves /report/ from dist/report/index.html.
const path = window.location.pathname.replace(/\/+$/, "") || "/";
const Page = path === "/report" ? ReportPage : path === "/attribution" ? AttributionPage : Console;
document.documentElement.classList.add(path === "/report" ? "page-report" : "page-console");
document.documentElement.lang = path === "/report" ? "vi" : "en";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<div className="boot" aria-busy="true" />}>
      <Page />
    </Suspense>
  </StrictMode>,
);
