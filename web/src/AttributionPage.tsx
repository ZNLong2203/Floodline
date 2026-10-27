import { useEffect, useMemo, useState } from "react";
import { Icon, Logo } from "./components/Icon";
import { api, href } from "./lib/api";
import type { AttributionData, MediaCredit, Report } from "./lib/types";

/** Commons serves a scaled thumbnail of any file (also a poster frame for videos). */
function commonsThumb(m: MediaCredit, width = 240): string | null {
  const title = m.commons_title?.replace(/^File:/, "");
  return title ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=${width}` : null;
}

const decode = (s?: string | null) => (s ?? "").replace(/&amp;/g, "&");

function shortDate(m: MediaCredit): string {
  const d = m.date ?? "";
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(d);
  return iso ? iso[1] : d.replace(/\s*\(.*\)\s*$/, "") || "–";
}

function Thumb({ m, local }: { m: MediaCredit; local?: string }) {
  const [failed, setFailed] = useState(false);
  const src = local ?? commonsThumb(m);
  const video = m.file.startsWith("videos/");
  if (!src || failed)
    return (
      <div className="attr__thumb attr__thumb--none" aria-hidden="true">
        <Icon name={video ? "play" : "image"} size={20} />
      </div>
    );
  return (
    <div className="attr__thumb">
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      {video && (
        <span className="attr__play" aria-hidden="true">
          <Icon name="play" size={14} />
        </span>
      )}
    </div>
  );
}

function CreditRow({ m, uses, local }: { m: MediaCredit; uses: number; local?: string }) {
  const unreviewed = m.license_review?.includes("unreviewed");
  return (
    <tr>
      <td className="attr__c-thumb">
        <Thumb m={m} local={local} />
      </td>
      <td className="attr__c-what">
        <div className="attr__visible">{m.visible || m.file}</div>
        <div className="attr__file">
          <code>{m.file}</code>
          {uses > 0 && (
            <span className="attr__inuse" title="Reports in the current scenario that use this photo">
              in scenario ×{uses}
            </span>
          )}
        </div>
      </td>
      <td data-label="Author">
        {m.author_url ? (
          <a href={decode(m.author_url)} target="_blank" rel="noreferrer">
            {m.author || "unknown"}
          </a>
        ) : (
          m.author || "unknown"
        )}
      </td>
      <td data-label="Licence">
        {m.license_url ? (
          <a href={m.license_url} target="_blank" rel="noreferrer">
            {m.license}
          </a>
        ) : (
          m.license || "–"
        )}
        {unreviewed && <div className="attr__flag">licence copied from Flickr by a bot, not reviewed</div>}
        {m.personality_rights_warning && <div className="attr__flag">personality rights apply</div>}
      </td>
      <td data-label="Source">
        {m.commons_page ? (
          <a href={m.commons_page} target="_blank" rel="noreferrer" className="attr__commons">
            Commons <Icon name="external" size={12} />
          </a>
        ) : (
          "–"
        )}
      </td>
      <td data-label="Place" lang="vi">
        {m.location || "–"}
        {m.lat != null && m.lon != null && (
          <div className="attr__coords num">
            {m.lat.toFixed(4)}, {m.lon.toFixed(4)}
          </div>
        )}
      </td>
      <td data-label="Date" className="num" title={m.date_note ?? m.date ?? undefined}>
        {shortDate(m)}
      </td>
    </tr>
  );
}

function CreditTable({ items, uses, local }: { items: MediaCredit[]; uses: Map<string, number>; local: Map<string, string> }) {
  return (
    <div className="attr__tablewrap">
      <table className="attr__table">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Thumbnail</span>
            </th>
            <th scope="col">What it shows</th>
            <th scope="col">Author</th>
            <th scope="col">Licence</th>
            <th scope="col">Source</th>
            <th scope="col">Place</th>
            <th scope="col">Date</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <CreditRow key={m.file} m={m} uses={uses.get(m.file) ?? 0} local={local.get(m.file)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** /attribution: credits for the real photos used by the demo scenario. */
export default function AttributionPage() {
  const [data, setData] = useState<AttributionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<Report[]>([]);

  useEffect(() => {
    document.title = "Photo credits · Floodline";
    api
      .attribution()
      .then(setData)
      .catch((e: Error) => setError(e.message || "Credits unavailable"));
    api.reports().then(setReports).catch(() => setReports([]));
  }, []);

  // Prefer the server's own copy of a photo for the thumbnail when a scenario report uses it.
  const { uses, local } = useMemo(() => {
    const uses = new Map<string, number>();
    const local = new Map<string, string>();
    for (const r of reports) {
      if (!r.photo_credit) continue;
      uses.set(r.photo_credit, (uses.get(r.photo_credit) ?? 0) + 1);
      if (!local.has(r.photo_credit)) local.set(r.photo_credit, r.image_url);
    }
    return { uses, local };
  }, [reports]);

  const photos = data?.photos ?? [];
  const videos = data?.videos ?? [];

  return (
    <div className="attr">
      <header className="rp__head">
        <a href={href("/")} className="rp__brand">
          <Logo size={28} />
          <span className="wordmark">Floodline</span>
        </a>
        <span className="rp__city">Photo credits</span>
      </header>
      <main className="attr__main">
        <h1>Demo scenario and photo credits</h1>
        <p lang="vi">
          <b>Kịch bản mô phỏng.</b> Các báo cáo có nhãn này dùng ảnh lũ thật ở Việt Nam từ Wikimedia Commons, được đặt lên
          các tuyến phố hay ngập ở Huế để trình diễn. Phần lớn ảnh không được chụp ở Huế; thời gian và lời nhắn là kịch bản.
        </p>
        <p>
          Reports marked as a simulated scenario use real photographs of floods in Vietnam, placed on Huế streets that flood
          often. Most were taken elsewhere; times and messages are scripted. Depth, overlay and every verdict are computed live by
          the pipeline from these photos. Overlays drawn on CC BY-SA photos are shared under the same licence.
        </p>
        {data?.retrieved && (
          <p className="muted attr__meta">
            Retrieved from {data.source ?? "Wikimedia Commons"} on {data.retrieved}. {data.note}
          </p>
        )}

        {error && (
          <div className="notice notice--bad" role="alert">
            <Icon name="alert" />
            <div>
              <b>Credits unavailable.</b> {error}. The full list is in <code>data/demo/ATTRIBUTION.md</code>.
            </div>
          </div>
        )}
        {!data && !error && (
          <div className="attr__loading">
            <span className="spinner spinner--sm" /> Loading credits…
          </div>
        )}
        {data && !photos.length && !videos.length && (
          <p className="muted">
            No credits to show. With the backend running, this page lists every photo in <code>data/demo/photos.json</code>.
          </p>
        )}

        {photos.length > 0 && (
          <section>
            <h2>
              Photos <span className="muted">· {photos.length}</span>
            </h2>
            <CreditTable items={photos} uses={uses} local={local} />
          </section>
        )}
        {videos.length > 0 && (
          <section>
            <h2>
              Video clips <span className="muted">· {videos.length}</span>
            </h2>
            <CreditTable items={videos} uses={uses} local={local} />
          </section>
        )}

        <p className="muted attr__foot">
          Map data © OpenStreetMap contributors (ODbL) · Basemap: OpenFreeMap, © OpenMapTiles.
        </p>
      </main>
    </div>
  );
}
