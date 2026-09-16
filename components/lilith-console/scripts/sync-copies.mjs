// Canonical-copy integrity for the Lilith Character Console.
// public/lilith/ is the single source of truth; the extension and the
// interactive mockup carry byte-identical copies that are regenerated
// deliberately, never edited in place.
//
//   node scripts/sync-copies.mjs           # check: exit 1 and list any drift
//   node scripts/sync-copies.mjs --write   # regenerate all copies from canonical
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const SHARED_FILES = ["lilith.css", "lilith.js", "roll-serializer.js"];
const ASSET_FILES = ["lilith-portrait.png", "slime-ornament.png", "panel-frame-v2.png", "stat-medallion-v2.png"];

export function buildPairs(root = projectRoot) {
  const canonical = join(root, "public", "lilith");
  const targets = [
    { dir: join(root, "extension"), html: "sheet.html" },
    { dir: join(root, "outputs", "Lilith-Interactive-Mockup"), html: "index.html" },
  ];
  const pairs = [];
  for (const target of targets) {
    pairs.push({ source: join(canonical, "index.html"), target: join(target.dir, target.html) });
    for (const name of SHARED_FILES) {
      pairs.push({ source: join(canonical, name), target: join(target.dir, name) });
    }
    for (const name of ASSET_FILES) {
      pairs.push({ source: join(canonical, "assets", name), target: join(target.dir, "assets", name) });
    }
  }
  return pairs;
}

async function hashFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function findDrift(pairs) {
  const drift = [];
  for (const pair of pairs) {
    let targetHash;
    try {
      targetHash = await hashFile(pair.target);
    } catch {
      drift.push({ ...pair, reason: "missing" });
      continue;
    }
    if ((await hashFile(pair.source)) !== targetHash) {
      drift.push({ ...pair, reason: "different" });
    }
  }
  return drift;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const pairs = buildPairs();
  if (process.argv.includes("--write")) {
    for (const pair of pairs) {
      await mkdir(dirname(pair.target), { recursive: true });
      await copyFile(pair.source, pair.target);
      console.log(`synced  ${relative(projectRoot, pair.target)}`);
    }
    console.log(`\n${pairs.length} copies regenerated from public/lilith/.`);
  } else {
    const drift = await findDrift(pairs);
    if (drift.length) {
      console.error("Copy drift detected (canonical: public/lilith/):");
      for (const item of drift) {
        console.error(`  ${item.reason.padEnd(9)} ${relative(projectRoot, item.target)}`);
      }
      console.error(`\n${drift.length} file(s) differ. Regenerate with: node scripts/sync-copies.mjs --write`);
      process.exit(1);
    }
    console.log(`All ${pairs.length} copies match public/lilith/.`);
  }
}
