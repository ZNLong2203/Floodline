import { useEffect, useRef } from "react";
import { Icon, VehicleIcon } from "../components/Icon";
import type { Catalog, Health, SourceRef } from "../lib/types";

const STEPS = [
  {
    name: "Muse Spark",
    tag: "perceive",
    text: "Finds reference objects of known size standing in the water (scooters, cars, people, doors), how each faces the camera, which part the water reaches, and what makes the photo untrustworthy.",
  },
  {
    name: "SAM 3.1",
    tag: "segment",
    text: "Segments the flood water, and a mask for every object Spark boxed. Every pixel is drawn on the overlay, so a coordinator can check it by eye.",
  },
  {
    name: "Geometry",
    tag: "measure",
    text: "Deterministic code reads the masks: where each object disappears into the water, its visible height and width in pixels. No model does the arithmetic.",
  },
  {
    name: "Consensus",
    tag: "estimate",
    text: "Each method gives an interval in metres. Outliers are dropped by median absolute deviation, the rest combined by inverse variance, and disagreement widens the result.",
  },
  {
    name: "Passability",
    tag: "decide",
    text: "Per vehicle, the probability the depth exceeds its limit. Under 10% is passable, over 60% impassable, in between risky. A wide, uncertain estimate is never reported as safe.",
  },
];

function sourceLabel(key: string, s: SourceRef | string): { title: string; url?: string; note?: string } {
  if (typeof s === "string") return { title: key, url: s.startsWith("http") ? s : undefined, note: s.startsWith("http") ? undefined : s };
  return {
    title: String(s.title ?? s.name ?? key),
    url: typeof s.url === "string" ? s.url : undefined,
    note: [s.publisher, s.note].filter(Boolean).join(" · ") || undefined,
  };
}

export function About({ catalog, health, onClose }: { catalog: Catalog; health: Health | null; onClose(): void }) {
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
            <div className="eyebrow">How it works</div>
            <h2 id="about-title">From a resident's photo to a route a rescue truck can take</h2>
          </div>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        <ol className="pipeline">
          {STEPS.map((s, i) => (
            <li key={s.name} className="pipeline__step">
              <div className="pipeline__num">{i + 1}</div>
              <div className="pipeline__name">{s.name}</div>
              <div className="pipeline__tag">{s.tag}</div>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>

        <div className="about__cols">
          <section>
            <h3>Streets, not just pins</h3>
            <p>
              Each photo updates the street it was taken on and, more weakly, the streets within 120 m. Its interval widens by
              0.3 m per 100 m of distance and doubles every 3 hours, so a fresh photo outweighs an old one two blocks away. Routes
              avoid impassable segments and avoid risky ones when they can.
            </p>
            <h3>Triage you can audit</h3>
            <p>
              Muse Spark extracts facts from the resident's words and voice note (people, injuries, who is vulnerable, whether the
              water is rising). The priority is a fixed, published formula over those facts and the measured depth, so two
              coordinators always see the same order and why.
            </p>
          </section>
          <section>
            <h3>Vehicle limits</h3>
            <ul className="about__vehicles">
              {catalog.vehicles.map((v) => (
                <li key={v.id}>
                  <VehicleIcon id={v.id} size={16} />
                  <span lang="vi">{v.name_vi}</span>
                  <span className="muted">{v.name_en}</span>
                  <span className="num">
                    {v.max_depth_m.toFixed(2)} m{v.max_depth_flowing_m ? ` · ${v.max_depth_flowing_m.toFixed(2)} m flowing` : ""}
                    {v.sources?.length ? <span className="muted"> · {v.sources.length} sources</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <h3>
              Sources{sources.length ? <span className="muted"> · {sources.length}</span> : null}
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
              <p className="muted">Reference sizes and vehicle limits are provisional; sourced values are being added to the catalog.</p>
            )}
          </section>
        </div>

        <footer className="about__foot">
          <span>
            Map data © OpenStreetMap contributors · Basemap: OpenFreeMap, © OpenMapTiles · Models: Meta Muse Spark, SAM 3.1
          </span>
          {health?.mode && <span className="mocktag mocktag--soft">model mode: {health.mode}</span>}
        </footer>
      </div>
    </div>
  );
}
