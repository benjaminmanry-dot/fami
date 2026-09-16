import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Lilith sheet shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Lilith • Iridescent Rampage<\/title>/i);
  assert.match(html, /src="\/lilith\/index\.html"/i);
  assert.match(html, /title="Lilith illustrated character sheet"/i);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Starter Project/i);
});

test("ships a self-contained offline sheet and Chrome bridge", async () => {
  const [sheet, css, script, manifest, install, portrait, ornament, panelFrame, statMedallion] = await Promise.all([
    readFile(new URL("../extension/sheet.html", import.meta.url), "utf8"),
    readFile(new URL("../extension/lilith.css", import.meta.url), "utf8"),
    readFile(new URL("../extension/lilith.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../extension/INSTALL.txt", import.meta.url), "utf8"),
    stat(new URL("../extension/assets/lilith-portrait.png", import.meta.url)),
    stat(new URL("../extension/assets/slime-ornament.png", import.meta.url)),
    stat(new URL("../extension/assets/panel-frame-v2.png", import.meta.url)),
    stat(new URL("../extension/assets/stat-medallion-v2.png", import.meta.url)),
  ]);

  const parsedManifest = JSON.parse(manifest);
  assert.equal(parsedManifest.manifest_version, 3);
  assert.equal(parsedManifest.background.service_worker, "background.js");
  assert.match(sheet, /id="tab-content"/);
  assert.match(sheet, /id="resource-list"/);
  assert.match(script, /chrome\.storage\.local/);
  assert.match(script, /LILITH_ROLL/);
  assert.match(css, /\.portrait-frame/);
  assert.doesNotMatch(css, /fonts\.googleapis\.com/);
  assert.match(install, /Load unpacked/);
  assert.ok(portrait.size > 100_000);
  assert.ok(ornament.size > 100_000);
  assert.ok(panelFrame.size > 100_000);
  assert.ok(statMedallion.size > 100_000);
});

test("ships the Roll20-transcribed combat formulas without pending data labels", async () => {
  const script = await readFile(new URL("../public/lilith/lilith.js", import.meta.url), "utf8");
  assert.match(script, /lilith-sheet-state-v2/);
  assert.match(script, /damage: "2\+6"/);
  assert.match(script, /damage: "1d10"/);
  assert.match(script, /Shiny Jeweled Warhammer \(2H\).*damage: "1d10\+4"/);
  assert.doesNotMatch(script, /Data pass pending|Final text pending|Final mechanics pending/);
});
