import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("Tailwind excludes the recoverable assistant corpus from release CSS", async () => {
  const stylesheet = await readFile(resolve("app/globals.css"), "utf8");

  assert.match(stylesheet, /^@source not "\.\.\/corpus";$/m);
});

test("release migrations contain only bounded tabletop storage", async () => {
  const releaseDrizzle = resolve("dist/.openai/drizzle");
  const migrationFiles = (await readdir(releaseDrizzle))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  assert.deepEqual(migrationFiles, [
    "0000_loud_sasquatch.sql",
    "0001_common_reavers.sql",
    "0002_young_vapor.sql",
  ]);

  const migrationText = (
    await Promise.all(
      migrationFiles.map((name) => readFile(resolve(releaseDrizzle, name), "utf8")),
    )
  ).join("\n");
  assert.doesNotMatch(migrationText, /assistant_corpus/i);
  assert.match(migrationText, /room_media_usage/i);

  const journal = JSON.parse(
    await readFile(resolve(releaseDrizzle, "meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  assert.deepEqual(
    journal.entries.map(({ tag }) => tag),
    ["0000_loud_sasquatch", "0001_common_reavers", "0002_young_vapor"],
  );
});

test("compiled release contains no dormant corpus or model-provider path", async () => {
  const entries = await readdir(resolve("dist"), { recursive: true });
  const textFiles = entries.filter((name) => /\.(?:css|html|js|json|mjs|sql|txt)$/i.test(name));
  const compiledText = (
    await Promise.all(textFiles.map((name) => readFile(resolve("dist", name), "utf8")))
  ).join("\n");

  assert.doesNotMatch(
    compiledText,
    /assistant_corpus|gpt-oss-20b|CLOUDFLARE_AUTH_TOKEN|assistant-corpus\.sql/i,
  );

  const workerConfig = JSON.parse(
    await readFile(resolve("dist/server/wrangler.json"), "utf8"),
  ) as { vars?: Record<string, string> };
  assert.equal(workerConfig.vars?.VTT_LOCAL_DEVELOPMENT, "");
  assert.equal(workerConfig.vars?.VTT_OWNER_USER_ID, "");
});
