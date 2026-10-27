// Screenshot the console and the resident page in mock mode.
//   npm run dev            (in another terminal)
//   npm run screenshots    [base URL, default http://localhost:5173]
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../screenshots");
const base = process.argv[2] ?? "http://localhost:5173";
const only = process.env.ONLY?.split(",");
mkdirSync(out, { recursive: true });

// Use whichever Chromium Playwright already downloaded, to avoid a fresh download.
function findChromium() {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return undefined;
  const dirs = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const d of dirs) {
    for (const arch of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64", "chrome-headless-shell-linux64"]) {
      const p = join(cache, d, arch, "chrome-headless-shell");
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? findChromium(),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !only || only.includes(name);
const shots = [];
async function shot(page, name, opts = {}) {
  const path = join(out, `${name}.png`);
  await page.screenshot({ path, ...opts });
  shots.push(path);
  console.log("saved", path);
}

// ------------------------------------------------------------- console
if (want("console") && !only?.includes("live")) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
  await page.goto(`${base}/?mock=1`);
  await page.waitForSelector(".card:not(.card--skeleton)");
  await page.waitForSelector(".mk");
  await wait(3500);
  await shot(page, "console-1280x720");

  // the late report arrives over the simulated live stream
  await page.waitForSelector(".card.is-fresh", { timeout: 12000 }).catch(() => {});
  await wait(600);
  await shot(page, "console-live-pulse");

  // route
  await page.click(".routebtn");
  await page.click(".preset >> nth=0");
  await page.waitForSelector(".routecard__result", { timeout: 10000 });
  await wait(1800);
  await shot(page, "console-route");

  // vehicle switch: on foot
  await page.click(".vchip >> nth=0");
  await wait(1500);
  await shot(page, "console-route-pedestrian");
  await page.click(".routecard .iconbtn");
  await page.click(".vchip >> nth=3");

  // detail drawer on the highest-priority card
  await page.click(".card >> nth=0");
  await page.waitForSelector(".detail");
  await wait(1200);
  await shot(page, "console-detail");
  await page.evaluate(() => {
    const s = document.querySelector(".detail__scroll");
    const d = document.querySelector(".dsec");
    if (s && d) s.scrollTop = d.offsetTop - 8;
  });
  await wait(400);
  await shot(page, "console-depth");
  await page.click(".photo__toggle button >> nth=1");
  await wait(400);
  await page.locator(".dsec").nth(1).scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const s = document.querySelector(".detail__scroll");
    const ev = [...document.querySelectorAll(".dsec")][1];
    if (s && ev) s.scrollTop = ev.offsetTop - 10;
  });
  await wait(500);
  await shot(page, "console-evidence");
  await page.evaluate(() => {
    const s = document.querySelector(".detail__scroll");
    if (s) s.scrollTop = s.scrollHeight;
  });
  await wait(400);
  await shot(page, "console-triage");
  await page.evaluate(() => {
    const s = document.querySelector(".detail__scroll");
    if (s) s.scrollTop = 0;
  });

  // hover a segment for the tooltip
  await page.click(".detail__head .iconbtn >> nth=0");
  await wait(300);

  // about
  await page.click('button[aria-label="How Floodline works"]');
  await wait(400);
  await shot(page, "console-about");
  await page.keyboard.press("Escape");

  // dark
  await page.click('button[aria-label="Switch to dark theme"]');
  await wait(2500);
  await page.click(".card >> nth=1");
  await wait(1200);
  await shot(page, "console-dark");
  await page.click('button[aria-label="Switch to light theme"]');
  await page.click(".detail__head .iconbtn >> nth=0").catch(() => {});

  // scenario replay progress (seed: {index, total} on each report.created)
  await page.click(".demo__btn");
  await page.click(".demo__menu button >> nth=0");
  await wait(4200);
  await shot(page, "console-replay-progress");
  await page.waitForSelector(".demo__btn:not(.is-running)", { timeout: 30000 }).catch(() => {});
  await ctx.close();
}

// ------------------------------------------------------------- resident page
if (want("report") || only?.includes("report-live")) {
  const live = only?.includes("report-live");
  const q = live ? "" : "?mock=1";
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: 21.0285, longitude: 105.8542 }, // Hà Nội: outside Huế
    permissions: ["geolocation"],
    locale: "vi-VN",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(`${base}/report${q}`);
  await page.waitForSelector(".camerabtn");
  await wait(1500);
  if (!live) await shot(page, "report-390x844");

  await page.click(".loc__notice .btn");
  await page.waitForSelector(".minimap");
  const photo = resolve(here, "../../data/demo/photos/hcmc-2013-scooter-rider-01.jpg");
  if (existsSync(photo)) await page.setInputFiles('input[capture="environment"]', photo);
  await page.fill("#note", "Nhà có 2 người già, nước đang lên, không ra được");
  await wait(2500);
  if (!live) await shot(page, "report-form-full", { fullPage: true });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log("horizontal overflow at 390px:", overflow);
  await page.setViewportSize({ width: 375, height: 812 });
  await wait(300);
  const overflow375 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log("horizontal overflow at 375px:", overflow375);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.click(".rp__submitbar .btn");
  await wait(6500);
  if (!live) await shot(page, "report-sending");
  await page.waitForSelector(live ? ".rp__error" : ".rp__result", { timeout: 60000 });
  await wait(800);
  await shot(page, live ? "report-live-error" : "report-result-full", { fullPage: !live });
  await ctx.close();
}

// ------------------------------------------------------------- mock assistant (ONLY=mockask)
if (only?.includes("mockask")) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(`${base}/?mock=1`);
  await page.waitForSelector(".card:not(.card--skeleton)");
  await wait(2500);
  await shot(page, "mock-console-en");
  await page.click(".askbtn");
  await page.waitForSelector(".ask__example");
  await page.click(".ask__example >> nth=0");
  await wait(3000);
  await shot(page, "mock-ask-thinking");
  await page.waitForSelector(".ask__a", { timeout: 30000 });
  await wait(2500);
  await shot(page, "mock-ask-answer");
  await page.click(".ask__how summary");
  await wait(400);
  await page.evaluate(() => document.querySelector(".ask__scroll")?.scrollTo({ top: 99999 }));
  await wait(400);
  await shot(page, "mock-ask-steps");
  await page.click(".ask__chip >> nth=0");
  await page.waitForSelector(".detail");
  await wait(1500);
  await page.evaluate(() => {
    const s = document.querySelector(".detail__scroll");
    const w = document.querySelector(".words");
    if (s && w) s.scrollTop = w.offsetTop - 120;
  });
  await wait(500);
  await shot(page, "mock-drawer-words");
  // Vietnamese UI
  await page.click('.langtoggle button:has-text("VI")');
  await wait(1200);
  await shot(page, "mock-drawer-vi");
  await ctx.close();
}

// ------------------------------------------------------------- seeded backend (ONLY=real)
// Only navigates, opens drawers, asks for routes (GET) and asks the assistant ONE recorded
// example question (POST /api/ask, which spends real credit). Never presses Replay, Clear or
// status buttons, never submits a report.
if (only?.includes("real")) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: "en-US" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  let asks = 0;
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const ask = req.method() === "POST" && new URL(req.url()).pathname === "/api/ask";
    if (req.method() !== "GET" && !(ask && asks++ < 1)) {
      console.error(`blocked ${req.method()} ${req.url()}`);
      return route.abort();
    }
    return route.continue();
  });
  const scrollTo = async (selector, offset = 10) => {
    await page.evaluate(
      ([sel, off]) => {
        const s = document.querySelector(".detail__scroll");
        const el = document.querySelector(sel);
        if (s && el) s.scrollTop = el.offsetTop - off;
      },
      [selector, offset],
    );
    await wait(600);
  };
  const back = async () => {
    await page.click('.detail button[aria-label="Back"]').catch(() => {});
    await wait(500);
  };

  await page.goto(`${base}/`);
  await page.waitForSelector(".card:not(.card--skeleton)", { timeout: 20000 });
  await page.waitForSelector(".mk");
  await wait(5000);
  await shot(page, "real-console");

  await page.click(".routebtn");
  await page.click(".preset >> nth=0");
  await page.waitForSelector(".routecard__result", { timeout: 15000 });
  await wait(2500);
  await shot(page, "real-route");
  await page.click(".routecard__result .btn");
  await page.click(".preset >> nth=1");
  await page.waitForSelector(".noroute", { timeout: 15000 });
  await wait(2500);
  await shot(page, "real-route-noroute");
  await page.click(".routecard .iconbtn");
  await wait(600);

  await page.click('.card:has-text("House No. 12")');
  await page.waitForSelector(".detail");
  await wait(3000);
  await shot(page, "real-drawer");
  await scrollTo(".words", 150);
  await shot(page, "real-drawer-translation");
  await scrollTo(".drafts", 300);
  await shot(page, "real-drawer-dispatch");
  await back();

  await page.click('.card:has(.card__clip):has-text("Phu Xuan")');
  await page.waitForSelector(".detail");
  await wait(4500);
  await shot(page, "real-drawer-clip");
  await scrollTo(".clipobjs", 250);
  await shot(page, "real-drawer-clip-frames");
  await back();

  await page.click('.card:has-text("gas station")');
  await page.waitForSelector(".detail");
  await wait(2500);
  await page.evaluate(() => {
    const s = document.querySelector(".detail__scroll");
    const ev = [...document.querySelectorAll(".dsec")].find((d) => d.querySelector(".ev"));
    if (s && ev) s.scrollTop = ev.offsetTop - 10;
  });
  await wait(600);
  await shot(page, "real-evidence");
  await back();

  if (!process.env.NO_ASK) {
    await page.click(".askbtn");
    await page.waitForSelector(".ask__example", { timeout: 15000 });
    await page.click('.ask__example:has-text("Chi Lăng")');
    await wait(6000);
    await shot(page, "real-ask-thinking");
    await page.waitForSelector(".ask__a, .ask__err", { timeout: 150000 });
    await wait(3500);
    await shot(page, "real-assistant");
    await page.click(".ask__how summary").catch(() => {});
    await wait(400);
    await page.evaluate(() => document.querySelector(".ask__scroll")?.scrollTo({ top: 99999 }));
    await wait(500);
    await shot(page, "real-assistant-steps");
  }

  await page.goto(`${base}/attribution`);
  await page.waitForSelector(".attr__table", { timeout: 15000 });
  await wait(3500);
  await shot(page, "real-attribution");
  await ctx.close();
}

// ------------------------------------------------------------- assistant only (ONLY=realask): one POST /api/ask
if (only?.includes("realask")) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: "en-US" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  let asks = 0;
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const ask = req.method() === "POST" && new URL(req.url()).pathname === "/api/ask";
    if (req.method() !== "GET" && !(ask && asks++ < 1)) {
      console.error(`blocked ${req.method()} ${req.url()}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${base}/`);
  await page.waitForSelector(".mk", { timeout: 20000 });
  await wait(3000);
  await page.click(".askbtn");
  await page.waitForSelector(".ask__example", { timeout: 15000 });
  await page.click('.ask__example:has-text("Chi Lăng")');
  await page.waitForSelector(".ask__a, .ask__err", { timeout: 150000 });
  await wait(4000);
  await shot(page, "real-assistant");
  await page.click(".ask__how summary").catch(() => {});
  await wait(400);
  await page.evaluate(() => document.querySelector(".ask__scroll")?.scrollTo({ top: 99999 }));
  await wait(600);
  await shot(page, "real-assistant-steps");
  await ctx.close();
}

// ------------------------------------------------------------- resident page, EN and VI (ONLY=resident, mock)
if (only?.includes("resident")) {
  for (const [lang, locale, geo] of [
    ["en", "en-US", { latitude: 37.4848, longitude: -122.1484 }],
    ["vi", "vi-VN", { latitude: 21.0285, longitude: 105.8542 }],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale,
      geolocation: geo,
      permissions: ["geolocation"],
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("pageerror:", e.message));
    await page.goto(`${base}/report?mock=1`);
    await page.waitForSelector(".camerabtn");
    await wait(2000);
    await shot(page, `resident-${lang}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`horizontal overflow on /report (${lang}):`, overflow);
    await ctx.close();
  }
}

// ------------------------------------------------------------- attribution (needs the backend)
if (only?.includes("attribution")) {
  for (const [name, vp] of [["attribution-1280", { width: 1280, height: 720 }], ["attribution-390", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: vp.width < 500 ? 2 : 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("pageerror:", e.message));
    await page.goto(`${base}/attribution`);
    await page.waitForSelector(".attr__table, .notice", { timeout: 15000 }).catch(() => {});
    await wait(3500);
    await shot(page, name);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`horizontal overflow on /attribution at ${vp.width}px:`, overflow);
    await ctx.close();
  }
}

// ------------------------------------------------------------- real backend (ONLY=live)
if (only?.includes("live")) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
  await page.goto(`${base}/`);
  await wait(4000);
  await shot(page, "live-empty");
  await page.click(".demo__btn");
  await page.click(".demo__menu button >> nth=0");
  if (process.env.SEED_WAIT) {
    // the backend has recordings for the scenario: wait for the replay to finish
    await page.waitForSelector(".demo__btn:not(.is-running)", { timeout: Number(process.env.SEED_WAIT) }).catch(() => {});
    await wait(2500);
    await shot(page, "live-seeded");
    await page.click(".card >> nth=0").catch(() => {});
    await wait(2000);
    await shot(page, "live-detail");
    await page.evaluate(() => {
      const s = document.querySelector(".detail__scroll");
      const ev = [...document.querySelectorAll(".dsec")][1];
      if (s && ev) s.scrollTop = ev.offsetTop - 10;
    });
    await wait(500);
    await shot(page, "live-evidence");
  } else {
    await wait(2500);
    await shot(page, "live-replay-result");
  }
  await ctx.close();
}

await browser.close();
console.log(`${shots.length} screenshots in ${out}`);
