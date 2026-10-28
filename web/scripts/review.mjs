// Visual review of every page and state, at desktop and phone sizes, in two
// language/theme combinations. Read-only: the empty state and the error toast are
// simulated in the browser (intercepted responses), nothing is sent to a server.
//   node scripts/review.mjs [base]        (dev server proxied to the replay backend)
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../screenshots/redesign2/review");
const base = process.argv[2] ?? "http://localhost:5174";
const only = process.env.ONLY?.split(",");
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
let n = 0;

const SIZES = [
  ["1440", { viewport: { width: 1440, height: 900 } }],
  ["390", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
];
const COMBOS = [
  ["en-light", "en", "light"],
  ["es-dark", "es", "dark"],
];

async function context(opts, theme) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("floodline-theme", t);
    } catch {}
  }, theme);
  return ctx;
}

async function shot(page, name) {
  await page.screenshot({ path: join(out, `${name}.png`) });
  n++;
}

for (const [size, opts] of SIZES)
  for (const [combo, lang, theme] of COMBOS) {
    const tag = `${size}-${combo}`;
    const want = (k) => !only || only.includes(k);
    const ctx = await context(opts, theme);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error(`[${tag}] pageerror:`, e.message));
    const mobile = size === "390";

    if (want("console")) {
      await page.goto(`${base}/?city=hue&lang=${lang}`);
      await page.waitForSelector(".mk", { timeout: 20000 });
      await wait(3500);
      await shot(page, `console-${tag}`);
      if (mobile) {
        await page.click(".viewtoggle button >> nth=0");
        await wait(800);
        await shot(page, `console-list-${tag}`);
      }
      // ⋯ menu
      await page.click(".morepop .tbtn");
      await wait(400);
      await shot(page, `menu-${tag}`);
      // About, from the menu
      await page.click('.morepop .pop__item:has(svg) >> nth=3');
      await page.waitForSelector(".about", { timeout: 5000 }).catch(() => {});
      await wait(600);
      await shot(page, `about-${tag}`);
      await page.keyboard.press("Escape");
      await wait(300);
      // error toast: the replay request is answered here with a 503
      await page.route("**/api/demo/seed**", (route) =>
        route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Replay is disabled on the public demo." }) }),
      );
      await page.click(".morepop .tbtn");
      await page.click(".morepop .pop__item >> nth=0");
      await wait(1200);
      await shot(page, `toast-${tag}`);
    }

    if (want("empty")) {
      // a city with no reports, simulated
      await page.route("**/api/reports?city=valencia", (route) => route.fulfill({ json: [] }));
      await page.route("**/api/segments?city=valencia", (route) => route.fulfill({ json: { type: "FeatureCollection", features: [] } }));
      await page.goto(`${base}/?city=valencia&lang=${lang}`);
      await wait(3500);
      if (mobile) await page.click(".viewtoggle button >> nth=0").catch(() => {});
      await wait(600);
      await shot(page, `empty-${tag}`);
    }

    if (want("report")) {
      await page.goto(`${base}/report?city=hue&lang=${lang}`);
      await page.waitForSelector(".samples__item", { timeout: 20000 });
      await wait(3500);
      await shot(page, `report-${tag}`);
    }

    if (want("attribution")) {
      await page.goto(`${base}/attribution?lang=${lang}`);
      await page.waitForSelector(".attr__table", { timeout: 20000 });
      await wait(2500);
      await shot(page, `attribution-${tag}`);
    }

    if (want("404")) {
      await page.goto(`${base}/no/such/page?lang=${lang}`);
      await page.waitForSelector(".nf", { timeout: 10000 });
      await wait(800);
      await shot(page, `404-${tag}`);
    }
    await ctx.close();
  }

await browser.close();
console.log(`${n} screenshots in ${out}`);
