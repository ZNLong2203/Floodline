import { useEffect, useMemo, useState } from "react";
import { Icon, Logo } from "./components/Icon";
import { api, href } from "./lib/api";
import { LangToggle, useI18n } from "./lib/i18n";
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
  const { t } = useI18n();
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
            <span className="attr__inuse" title={t("attr.inScenario", { n: uses })}>
              {t("attr.inScenario", { n: uses })}
            </span>
          )}
        </div>
      </td>
      <td data-label={t("attr.author")}>
        {m.author_url ? (
          <a href={decode(m.author_url)} target="_blank" rel="noreferrer">
            {m.author || t("attr.unknown")}
          </a>
        ) : (
          m.author || t("attr.unknown")
        )}
      </td>
      <td data-label={t("attr.licence")}>
        {m.license_url ? (
          <a href={m.license_url} target="_blank" rel="noreferrer">
            {m.license}
          </a>
        ) : (
          m.license || "–"
        )}
        {unreviewed && <div className="attr__flag">{t("attr.unreviewed")}</div>}
        {m.personality_rights_warning && <div className="attr__flag">{t("attr.personality")}</div>}
      </td>
      <td data-label={t("attr.source")}>
        {m.commons_page ? (
          <a href={m.commons_page} target="_blank" rel="noreferrer" className="attr__commons">
            Commons <Icon name="external" size={12} />
          </a>
        ) : (
          "–"
        )}
      </td>
      <td data-label={t("attr.place")}>
        {m.location || "–"}
        {m.lat != null && m.lon != null && (
          <div className="attr__coords num">
            {m.lat.toFixed(4)}, {m.lon.toFixed(4)}
          </div>
        )}
      </td>
      <td data-label={t("attr.date")} className="num" title={m.date_note ?? m.date ?? undefined}>
        {shortDate(m)}
      </td>
    </tr>
  );
}

function CreditTable({ items, uses, local }: { items: MediaCredit[]; uses: Map<string, number>; local: Map<string, string> }) {
  const { t } = useI18n();
  return (
    <div className="attr__tablewrap">
      <table className="attr__table">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">{t("attr.thumb")}</span>
            </th>
            <th scope="col">{t("attr.what")}</th>
            <th scope="col">{t("attr.author")}</th>
            <th scope="col">{t("attr.licence")}</th>
            <th scope="col">{t("attr.source")}</th>
            <th scope="col">{t("attr.place")}</th>
            <th scope="col">{t("attr.date")}</th>
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
  const { t } = useI18n();
  const [data, setData] = useState<AttributionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<Report[]>([]);

  useEffect(() => {
    document.title = `${t("attr.pageTitle")} · Floodline`;
    api
      .attribution()
      .then(setData)
      .catch((e: Error) => setError(e.message || t("attr.unavailable")));
    api.reports().then(setReports).catch(() => setReports([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <header className="rp__bar">
        <a href={href("/")} className="rp__brand">
          <Logo size={28} />
          <span className="wordmark">Floodline</span>
        </a>
        <span className="attr__barright">
          <span className="muted">{t("attr.pageTitle")}</span>
          <LangToggle />
        </span>
      </header>
      <main className="attr__main">
        <h1>{t("attr.title")}</h1>
        <p>{t("attr.p1")}</p>
        {data?.retrieved && (
          <p className="muted attr__meta">
            {t("attr.retrieved", { source: data.source ?? "Wikimedia Commons", date: data.retrieved })} {data.note}
          </p>
        )}

        {error && (
          <div className="notice notice--bad" role="alert">
            <Icon name="alert" />
            <div>
              <b>{t("attr.unavailable")}</b> {error}. <code>data/demo/ATTRIBUTION.md</code>
            </div>
          </div>
        )}
        {!data && !error && (
          <div className="attr__loading">
            <span className="spinner spinner--sm" /> {t("attr.loading")}
          </div>
        )}
        {data && !photos.length && !videos.length && (
          <p className="muted">{t("attr.none")}</p>
        )}

        {photos.length > 0 && (
          <section>
            <h2>
              {t("attr.photos")} <span className="muted">· {photos.length}</span>
            </h2>
            <CreditTable items={photos} uses={uses} local={local} />
          </section>
        )}
        {videos.length > 0 && (
          <section>
            <h2>
              {t("attr.videos")} <span className="muted">· {videos.length}</span>
            </h2>
            <CreditTable items={videos} uses={uses} local={local} />
          </section>
        )}

        <p className="muted attr__foot">{t("about.foot")}</p>
      </main>
    </div>
  );
}
