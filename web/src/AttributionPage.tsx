import { useEffect, useState } from "react";
import { Logo } from "./components/Icon";
import { api, href } from "./lib/api";
import type { Report } from "./lib/types";

/** Fallback page for /attribution. The backend may serve a richer one at the same path. */
export default function AttributionPage() {
  const [reports, setReports] = useState<Report[] | null>(null);
  useEffect(() => {
    document.title = "Photo credits · Floodline";
    api.reports().then(setReports).catch(() => setReports([]));
  }, []);
  const credits = [...new Set((reports ?? []).filter((r) => r.scenario && r.photo_credit).map((r) => r.photo_credit!))].sort();

  return (
    <div className="attr">
      <header className="rp__head">
        <a href={href("/")} className="rp__brand">
          <Logo size={28} />
          <span className="wordmark">Floodline</span>
        </a>
      </header>
      <main className="attr__main">
        <h1>Demo scenario and photo credits</h1>
        <p lang="vi">
          <b>Kịch bản mô phỏng.</b> Các báo cáo có nhãn này dùng ảnh lũ thật ở Việt Nam từ Wikimedia Commons, được đặt lên
          các tuyến phố hay ngập ở Huế để trình diễn. Phần lớn ảnh không được chụp ở Huế; thời gian và lời nhắn là kịch bản.
        </p>
        <p>
          Reports marked as a simulated scenario use real photographs of floods in Vietnam from Wikimedia Commons, placed on Huế
          streets that flood often, for the demo. Most were taken elsewhere; times and messages are scripted. The depth, the
          overlay and every verdict are computed live by the pipeline from those photos.
        </p>
        <p>
          Each photo's author, license (CC0, CC BY, CC BY-SA or public domain) and Commons page are listed in{" "}
          <code>data/demo/ATTRIBUTION.md</code> in the Floodline repository. Overlays drawn on CC BY-SA photos are shared under the
          same license.
        </p>
        {credits.length > 0 && (
          <>
            <h2>Photos in the current scenario</h2>
            <ul className="attr__list">
              {credits.map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted">Map data © OpenStreetMap contributors (ODbL) · Basemap: OpenFreeMap, © OpenMapTiles.</p>
      </main>
    </div>
  );
}
