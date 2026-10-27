import { useEffect, useRef } from "react";
import { Icon, VehicleIcon } from "../components/Icon";
import { vehicleName } from "../lib/catalog";
import { cityLabel } from "../lib/cities";
import { type Key, useI18n } from "../lib/i18n";
import type { Catalog, City, Health, SourceRef } from "../lib/types";

const STEPS = ["Muse Spark", "SAM 3.1", "Geometry", "Consensus", "Passability"];

function sourceLabel(key: string, s: SourceRef | string): { title: string; url?: string; note?: string } {
  if (typeof s === "string") return { title: key, url: s.startsWith("http") ? s : undefined, note: s.startsWith("http") ? undefined : s };
  return {
    title: String(s.title ?? s.name ?? key),
    url: typeof s.url === "string" ? s.url : undefined,
    note: [s.publisher, s.note].filter(Boolean).join(" · ") || undefined,
  };
}

export function About({ catalog, health, city, onClose }: { catalog: Catalog; health: Health | null; city: City; onClose(): void }) {
  const { t, lang } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("keydown", esc);
      prev?.focus();
    };
  }, [onClose]);
  const sources = Object.entries(catalog.sources ?? {});

  return (
    <div className="modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__card about" role="dialog" aria-modal="true" aria-labelledby="about-title" tabIndex={-1} ref={dialog}>
        <header className="about__head">
          <div>
            <div className="eyebrow">{t("about.eyebrow")}</div>
            <h2 id="about-title">{t("about.title")}</h2>
          </div>
          <button type="button" className="iconbtn" onClick={onClose} aria-label={t("common.close")}>
            <Icon name="close" />
          </button>
        </header>

        {city.story && (
          <div className="about__story">
            <Icon name="pin" size={16} />
            <div>
              <b>{t("about.story", { city: cityLabel(city) })}</b>
              <p>{city.story}</p>
            </div>
          </div>
        )}

        <ol className="pipeline">
          {STEPS.map((name, i) => (
            <li key={name} className="pipeline__step">
              <div className="pipeline__num">{i + 1}</div>
              <div className="pipeline__name">{name}</div>
              <div className="pipeline__tag">{t(`about.s${i + 1}.tag` as Key)}</div>
              <p>{t(`about.s${i + 1}` as Key)}</p>
            </li>
          ))}
        </ol>

        <div className="about__cols">
          <section>
            <h3>{t("about.languages")}</h3>
            <p>{t("about.languagesText")}</p>
            <h3>{t("about.streets")}</h3>
            <p>{t("about.streetsText")}</p>
            <h3>{t("about.triage")}</h3>
            <p>{t("about.triageText")}</p>
          </section>
          <section>
            <h3>{t("about.vehicles")}</h3>
            <ul className="about__vehicles">
              {catalog.vehicles.map((v) => (
                <li key={v.id}>
                  <VehicleIcon id={v.id} size={16} />
                  <span>{vehicleName(v, lang)}</span>
                  <span className="muted">{lang === "en" ? v.name_vi : v.name_en}</span>
                  <span className="num">
                    {v.max_depth_m.toFixed(2)} m{v.max_depth_flowing_m ? ` · ${t("about.flowing", { m: v.max_depth_flowing_m.toFixed(2) })}` : ""}
                    {v.sources?.length ? <span className="muted"> · {t("about.sourcesN", { n: v.sources.length })}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <h3>
              {t("about.sources")}
              {sources.length ? <span className="muted"> · {sources.length}</span> : null}
            </h3>
            {sources.length ? (
              <ul className="about__sources">
                {sources.map(([k, s]) => {
                  const l = sourceLabel(k, s);
                  return (
                    <li key={k}>
                      {l.url ? (
                        <a href={l.url} target="_blank" rel="noreferrer">
                          {l.title} <Icon name="external" size={12} />
                        </a>
                      ) : (
                        <b>{l.title}</b>
                      )}
                      {l.note && <span className="muted"> · {l.note}</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">{t("about.provisional")}</p>
            )}
          </section>
        </div>

        <footer className="about__foot">
          <span>{t("about.foot")}</span>
          {health?.mode && <span className="mocktag mocktag--soft">{t("about.mode", { m: health.mode })}</span>}
        </footer>
      </div>
    </div>
  );
}
