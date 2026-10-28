import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/console.css";
import "./styles/report.css";

import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./lib/i18n";

const Console = lazy(() => import("./console/Console"));
const ReportPage = lazy(() => import("./report/ReportPage"));
const AttributionPage = lazy(() => import("./AttributionPage"));
const NotFound = lazy(() => import("./NotFound"));

// Plain pathname routing. FastAPI serves /report/ from dist/report/index.html.
const path = window.location.pathname.replace(/\/+$/, "") || "/";
const Page =
  path === "/" || path === "/index.html"
    ? Console
    : path === "/report"
      ? ReportPage
      : path === "/attribution"
        ? AttributionPage
        : NotFound;
document.documentElement.classList.add(
  Page === Console ? "page-console" : Page === ReportPage ? "page-report" : "page-doc",
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider surface={path === "/report" ? "report" : "console"}>
      <Suspense fallback={<div className="boot" aria-busy="true" />}>
        <Page />
      </Suspense>
    </I18nProvider>
  </StrictMode>,
);
