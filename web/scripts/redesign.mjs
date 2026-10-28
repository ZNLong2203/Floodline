// Layout audit and screenshots for the redesign, against a local replay backend.
//   FLOODLINE_API=http://127.0.0.1:8012 npx vite --port 5174   (backend on :8012, no key)
//   node scripts/redesign.mjs [base]          ONLY=audit|console|ask|drawer|report|docs
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../screenshots/redesign");
const base = process.argv[2] ?? "http://localhost:5174";
const only = process.env.ONLY?.split(",");
const want = (n) => !only || only.includes(n);
mkdirSync(out, { recursive: true });

function findChromium() {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return undefined;
  for (const d of readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse()) {
    const p = join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
    if (existsSync(p)) return p;
  }
  return undefined;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? findChromium(),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let shots = 0;
async function shot(page, name, opts = {}) {
  await page.screenshot({ path: join(out, `${name}.png`), ...opts });
  shots++;
}

/** Elements that stick out of the viewport or whose content is cut by their own box. */
async function audit(page, label) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const issues = [];
    const doc = document.documentElement.scrollWidth - vw;
    if (doc > 0) issues.push(`page scrolls sideways by ${doc}px`);
    const name = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}${el.textContent ? ` "${el.textContent.trim().slice(0, 30)}"` : ""}`;
    // visible elements in the bars and cards must lie within the viewport
    for (const el of document.querySelectorAll(".topbar *, .queue__head *, .card *, .detail__head *, .statusbar *, .routecard *, .rp *")) {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || el.closest(".pop__menu")) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.right > vw + 0.5 || b.left < -0.5) issues.push(`outside viewport: ${name(el)} [${Math.round(b.left)}..${Math.round(b.right)}]`);
    }
    // containers that clip children without an ellipsis: cards, buttons, chips
    for (const el of document.querySelectorAll(".card, .tbtn, .vseg button, .statusbtn, .verdict, .pill, .routecard__place, .rv__item, .btn")) {
      const s = getComputedStyle(el);
      if (s.display === "none") continue;
      if (el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== "ellipsis") issues.push(`content cut: ${name(el)} (${el.scrollWidth} > ${el.clientWidth})`);
    }
    return [...new Set(issues)].slice(0, 12);
  });
  console.log(`${r.length ? "FAIL" : "ok  "} ${label}${r.length ? `\n      ${r.join("\n      ")}` : ""}`);
  return r.length;
}

async function consolePage(vp, city, lang = "en") {
  const ctx = await browser.newContext({ viewport: vp, locale: "en-US" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(`${base}/?city=${city}&lang=${lang}`);
  await page.waitForSelector(".mk", { timeout: 20000 });
  await page.waitForSelector(".card:not(.card--skeleton)", { timeout: 20000 }).catch(() => {});
  await wait(3500);
  return { ctx, page };
}

let failures = 0;
const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

// ------------------------------------------------------------- audit every size, city and language
if (want("audit")) {
  for (const vp of SIZES)
    for (const city of ["hue", "valencia"])
      for (const lang of ["en", "es", "vi"]) {
        const { ctx, page } = await consolePage(vp, city, lang);
        failures += await audit(page, `console ${vp.width}x${vp.height} ${city} ${lang}`);
        if (lang === "en" || vp.width <= 1280) {
          await page.click(".card >> nth=0");
          await page.waitForSelector(".detail");
          await wait(800);
          failures += await audit(page, `  drawer ${vp.width} ${city} ${lang}`);
          await page.click('.detail button[aria-label]:first-child').catch(() => {});
          await page.click('button:has(svg) >> text=/Plan route|Planificar ruta|Tìm đường/').catch(() => {});
          await page.click(".preset >> nth=0").catch(() => {});
          await wait(1500);
          failures += await audit(page, `  route ${vp.width} ${city} ${lang}`);
        }
        await ctx.close();
      }
  for (const vp of [
    { width: 900, height: 700 },
    { width: 390, height: 844 },
  ]) {
    const { ctx, page } = await consolePage(vp, "hue");
    failures += await audit(page, `console ${vp.width} (narrow, map view)`);
    await page.click('.viewtoggle button >> nth=0');
    await wait(600);
    failures += await audit(page, `console ${vp.width} (narrow, list view)`);
    await ctx.close();
  }
  for (const w of [360, 390]) {
    for (const lang of ["en", "vi", "es"]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(`${base}/report?lang=${lang}`);
      await page.waitForSelector(".samples__item", { timeout: 15000 });
      await wait(1500);
      failures += await audit(page, `report ${w} ${lang}`);
      await ctx.close();
    }
  }
}

// ------------------------------------------------------------- console screenshots
if (want("console")) {
  for (const vp of [
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ])
    for (const city of ["hue", "valencia"]) {
      const { ctx, page } = await consolePage(vp, city);
      await shot(page, `console-${vp.width}-${city}`);
      await ctx.close();
    }
}

// ------------------------------------------------------------- ask with an answer (recorded example on :8012)
if (want("ask")) {
  const { ctx, page } = await consolePage({ width: 1280, height: 800 }, "hue");
  await page.click('.topbar__right .tbtn:has-text("Ask")');
  await page.waitForSelector(".ask__example", { timeout: 15000 });
  await page.click('.ask__example:has-text("Chi Lăng")');
  await page.waitForSelector(".ask__thinking", { timeout: 5000 }).catch(() => {});
  await shot(page, "ask-thinking-1280");
  await page.waitForSelector(".ask__a, .ask__err", { timeout: 120000 });
  await wait(4000);
  await shot(page, "ask-1280");
  await page.click(".ask__details summary").catch(() => {});
  await wait(300);
  await page.evaluate(() => document.querySelector(".ask__scroll")?.scrollTo({ top: 99999 }));
  await wait(500);
  await shot(page, "ask-details-1280");
  await ctx.close();
}

// ------------------------------------------------------------- drawers
if (want("drawer")) {
  const { ctx, page } = await consolePage({ width: 1024, height: 768 }, "hue");
  await page.click(".card >> nth=0");
  await page.waitForSelector(".detail");
  await wait(2500);
  await shot(page, "drawer-1024");
  await page.evaluate(() => {
    const s = document.querySelector(".detail__scroll");
    const w = document.querySelector(".words");
    if (s && w) s.scrollTop = w.offsetTop - 120;
  });
  await wait(500);
  await shot(page, "drawer-1024-translation");
  await ctx.close();
}

// ------------------------------------------------------------- docs images (1280×800)
if (want("docs")) {
  const vp = { width: 1280, height: 800 };
  let { ctx, page } = await consolePage(vp, "hue");
  await shot(page, "docs-console");
  await page.click(".routebtn");
  await page.click(".preset >> nth=0");
  await page.waitForSelector(".routecard__result", { timeout: 15000 });
  await wait(2500);
  await shot(page, "docs-route");
  await page.click(".routecard .iconbtn");
  await wait(500);
  await page.click('.card:has(.card__clip)');
  await page.waitForSelector(".detail");
  await wait(4000);
  await shot(page, "docs-clip");
  await page.click('.detail button[aria-label]:first-child');
  await wait(400);
  await page.click(".queue .seg button >> nth=1");
  await page.click('.card:has-text("gas station")');
  await page.waitForSelector(".detail");
  await wait(2000);
  await page.evaluate(() => {
    const s = document.querySelector(".detail__scroll");
    const ev = [...document.querySelectorAll(".dsec")].find((d) => d.querySelector(".ev"));
    if (s && ev) s.scrollTop = ev.offsetTop - 10;
  });
  await wait(600);
  await shot(page, "docs-evidence");
  await ctx.close();
  ({ ctx, page } = await consolePage(vp, "valencia"));
  await page.click(".routebtn");
  await page.click('.preset:has-text("Alfafar")');
  await page.waitForSelector(".routecard__result", { timeout: 15000 });
  await wait(3000);
  await shot(page, "docs-valencia");
  await ctx.close();
}

// ------------------------------------------------------------- Spanish assistant and a translation drawer, for the README
if (want("extra")) {
  let { ctx, page } = await consolePage({ width: 1280, height: 800 }, "valencia", "es");
  await page.click('.topbar__right .tbtn:has-text("Preguntar")');
  await page.waitForSelector(".ask__example", { timeout: 15000 });
  await page.click('.ask__example:has-text("mayor peligro")');
  await page.waitForSelector(".ask__a, .ask__err", { timeout: 120000 });
  await wait(4000);
  await shot(page, "ask-1280-es");
  await ctx.close();
  ({ ctx, page } = await consolePage({ width: 1280, height: 800 }, "hue"));
  await page.click(".card >> nth=0");
  await page.waitForSelector(".detail");
  await wait(2500);
  await page.evaluate(() => {
    const s = document.querySelector(".detail__scroll");
    const w = document.querySelector(".words");
    if (s && w) s.scrollTop = w.offsetTop - 140;
  });
  await wait(600);
  await shot(page, "drawer-1280-translation");
  await ctx.close();
}

// ------------------------------------------------------------- resident page
if (want("sample")) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/report?city=hue`);
  await page.waitForSelector(".samples__item", { timeout: 15000 });
  await wait(1500);
  await page.click(".samples__item >> nth=0");
  await page.waitForSelector(".rp__preview", { timeout: 15000 });
  await wait(1500);
  await page.evaluate(() => {
    const sec = document.querySelector(".rp__sec");
    if (sec) window.scrollTo({ top: sec.getBoundingClientRect().top + window.scrollY - 12 });
  });
  await wait(800);
  await shot(page, "report-sample-390");
  await ctx.close();
}

if (want("report")) {
  const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const ctx = await browser.newContext(mobile);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(`${base}/report?city=hue`);
  await page.waitForSelector(".samples__item", { timeout: 15000 });
  await wait(2500);
  await shot(page, "report-form-390");
  await shot(page, "report-form-390-full", { fullPage: true });
  await page.click(".samples__item >> nth=0");
  await page.waitForSelector(".rp__preview", { timeout: 15000 });
  await wait(1500);
  await page.evaluate(() => {
    const sec = document.querySelector(".rp__sec");
    if (sec) window.scrollTo({ top: sec.getBoundingClientRect().top + window.scrollY - 12 });
  });
  await wait(600);
  await shot(page, "report-sample-390");
  // hold the upload for a few seconds so the progress screen can be seen
  await page.route("**/api/reports", async (route) => {
    if (route.request().method() === "POST") await wait(7000);
    return route.continue();
  });
  await page.click(".rp__send");
  await wait(4500);
  await shot(page, "report-progress-390");
  await page.waitForSelector(".rp__result, .rp__error", { timeout: 60000 });
  await wait(1500);
  await shot(page, "report-result-390");
  await shot(page, "report-result-390-full", { fullPage: true });
  await ctx.close();

  const wide = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await wide.newPage();
  await p2.goto(`${base}/report?city=hue`);
  await p2.waitForSelector(".samples__item", { timeout: 15000 });
  await wait(2500);
  await shot(p2, "report-form-1280");
  await wide.close();
}

await browser.close();
console.log(`${shots} screenshots in ${out}${want("audit") ? ` · ${failures} layout problems` : ""}`);
