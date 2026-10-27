// Build src/mock/roads.json from the backend's OpenStreetMap extract
// (../data/hue_roads.json). Mock mode uses it to draw real Huế streets and to
// route without the backend. Run: npm run mock:roads
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../data/hue_roads.json");
const dst = resolve(here, "../src/mock/roads.json");

const raw = JSON.parse(readFileSync(src, "utf8"));
const index = new Map();
const nodes = [];
const names = [""];
const highways = [];
const ways = [];

const nameIdx = (n) => {
  let i = names.indexOf(n);
  if (i < 0) i = names.push(n) - 1;
  return i;
};
const hwIdx = (h) => {
  let i = highways.indexOf(h);
  if (i < 0) i = highways.push(h) - 1;
  return i;
};

for (const way of raw.ways) {
  const ids = [];
  for (const id of way.nodes) {
    const p = raw.nodes[String(id)];
    if (!p) continue;
    if (!index.has(id)) {
      index.set(id, nodes.length);
      nodes.push([Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]);
    }
    ids.push(index.get(id));
  }
  if (ids.length >= 2) ways.push([nameIdx(way.name || ""), hwIdx(way.highway), ids]);
}

writeFileSync(
  dst,
  JSON.stringify({ attribution: raw.source, nodes, names, highways, ways }),
);
console.log(`${ways.length} ways, ${nodes.length} nodes -> ${dst}`);
