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
  await wait(Number(process.env.SEED_WAIT ?? 25000));
  await shot(page, "live-seeding");
  await page.waitForSelector(".demo__btn:not(.is-running)", { timeout: 240000 }).catch(() => {});
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
  await ctx.close();
}

await browser.close();
console.log(`${shots.length} screenshots in ${out}`);
