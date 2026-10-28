import { useEffect, useMemo, useState } from "react";
import { Icon, Logo } from "./components/Icon";
import { api, href } from "./lib/api";
import { FALLBACK_CITIES } from "./lib/cities";
import { LangToggle, useI18n } from "./lib/i18n";
import type { AttributionData, City, MediaCredit, Report } from "./lib/types";

/** Credits from both photos.json files: Valencia's use `place` and `description`. */
type Credit = MediaCredit & { city?: string; place?: string | null; description?: string | null; kind?: string };

const decode = (s?: string | null) => (s ?? "").replace(/&amp;/g, "&");
const isVideo = (m: Credit) => m.kind === "clip" || /\.(mp4|webm)$/i.test(m.file) || m.file.includes("videos/");

function thumb(m: Credit): string | null {
  if (!isVideo(m)) return `/api/demo-media/${m.file}`;
  const title = m.commons_title?.replace(/^File:/, "");
  return title ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=240` : null;
}

function shortDate(m: Credit): string {
  const d = m.date ?? "";
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(d);
  return iso ? iso[1] : d.replace(/\s*\(.*\)\s*$/, "") || "–";
}

function Thumb({ m }: { m: Credit }) {
  const [failed, setFailed] = useState(false);
  const src = thumb(m);
  if (!src || failed)
    return (
      <div className="attr__thumb attr__thumb--none" aria-hidden="true">
        <Icon name={isVideo(m) ? "video" : "image"} size={20} />
      </div>
    );
  return (
    <div className="attr__thumb">
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      {isVideo(m) && (
        <span className="attr__play" aria-hidden="true">
          <Icon name="play" size={13} />
        </span>
      )}
    </div>
  );
}

function Row({ m, uses, cityName }: { m: Credit; uses: number; cityName?: string }) {
  const { t } = useI18n();
  const unreviewed = m.license_review?.includes("unreviewed");
  const place = m.location || m.place;
  return (
    <tr>
      <td className="attr__c-thumb">
        <Thumb m={m} />
      </td>
      <td className="attr__c-what">
        <div className="attr__visible">{m.visible || m.description || m.file}</div>
        <div className="attr__file">
          {cityName && <span className="attr__city">{cityName}</span>}
          {uses > 0 && <span className="attr__inuse">{t("attr.inScenario", { n: uses })}</span>}
          <code>{m.file}</code>
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
        {place || "–"}
        {m.lat != null && m.lon != null && (
          <div className="attr__coords num">
            {m.lat.toFixed(4)}, {m.lon.toFixed(4)}
          </div>
        )}
      </td>
      <td data-label={t("attr.date")} className="num attr__date" title={m.date_note ?? m.date ?? undefined}>
        {shortDate(m)}
      </td>
    </tr>
  );
}

function Table({ items, uses, cityNames }: { items: Credit[]; uses: Map<string, number>; cityNames: Map<string, string> }) {
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
            <Row key={m.file} m={m} uses={uses.get(m.file) ?? 0} cityName={m.city ? cityNames.get(m.city) : undefined} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** /attribution: credits for the real photos and clips used by the demo scenarios. */
export default function AttributionPage() {
  const { t } = useI18n();
  const [data, setData] = useState<AttributionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cities, setCities] = useState<City[]>(FALLBACK_CITIES);
  const [reports, setReports] = useState<Report[]>([]);
  const [filter, setFilter] = useState<string>(() => new URLSearchParams(window.location.search).get("city") ?? "all");

  useEffect(() => {
    document.title = `${t("attr.pageTitle")} · Floodline`;
  }, [t]);

  useEffect(() => {
    api
      .attribution()
      .then(setData)
      .catch((e: Error) => setError(e.message || t("attr.unavailable")));
    api
      .cities()
      .then((cs) => {
        if (!Array.isArray(cs) || !cs.length) return;
        setCities(cs);
        Promise.all(cs.map((c) => api.reports(c.id).catch(() => [] as Report[]))).then((rs) => setReports(rs.flat()));
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uses = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reports) if (r.photo_credit) m.set(r.photo_credit, (m.get(r.photo_credit) ?? 0) + 1);
    return m;
  }, [reports]);
  const cityNames = useMemo(() => new Map(cities.map((c) => [c.id, c.name])), [cities]);
  const photos = (data?.photos ?? []) as Credit[];
  const videos = (data?.videos ?? []) as Credit[];
  const all = [...photos, ...videos];
  const keep = (m: Credit) => filter === "all" || m.city === filter;
  const shownPhotos = photos.filter(keep);
  const shownVideos = videos.filter(keep);
  const tagged = cities.filter((c) => all.some((m) => m.city === c.id));

  return (
    <div className="attr">
      <header className="rp__bar">
        <a href={href("/")} className="rp__brand">
          <Logo size={26} />
          <span className="wordmark">Floodline</span>
        </a>
        <LangToggle />
      </header>
      <main className="attr__main">
        <div className="attr__header">
          <div className="eyebrow">{t("attr.eyebrow")}</div>
          <h1>{t("attr.title")}</h1>
          <p>{t("attr.p1")}</p>
          {data?.retrieved && (
            <p className="attr__meta">
              {t("attr.retrieved", { source: data.source ?? "Wikimedia Commons", date: data.retrieved })} {data.note}
            </p>
          )}
        </div>

        {tagged.length > 0 && (
          <div className="attr__filters seg" role="tablist" aria-label={t("attr.filter")}>
            <button type="button" role="tab" aria-selected={filter === "all"} className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>
              {t("attr.filterAll")} <span className="seg__n">{all.length}</span>
            </button>
            {tagged.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={filter === c.id} className={filter === c.id ? "is-on" : ""} onClick={() => setFilter(c.id)}>
                {c.name} <span className="seg__n">{all.filter((m) => m.city === c.id).length}</span>
              </button>
            ))}
          </div>
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
        {data && !all.length && <p className="muted">{t("attr.none")}</p>}

        {shownPhotos.length > 0 && (
          <section>
            <h2>
              {t("attr.photos")} <span className="muted">· {shownPhotos.length}</span>
            </h2>
            <Table items={shownPhotos} uses={uses} cityNames={cityNames} />
          </section>
        )}
        {shownVideos.length > 0 && (
          <section>
            <h2>
              {t("attr.videos")} <span className="muted">· {shownVideos.length}</span>
            </h2>
            <Table items={shownVideos} uses={uses} cityNames={cityNames} />
          </section>
        )}

        <p className="attr__foot">{t("about.foot")}</p>
      </main>
    </div>
  );
}
