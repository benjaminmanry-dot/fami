import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareFamiliarCharacterHandoff } from "../lib/character-handoff.ts";

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error("Pass a Familiar plan JSON file and a new output character JSON file.");
}

const inputFile = resolve(inputArgument);
const outputFile = resolve(outputArgument);
if ((await stat(inputFile)).size > 1_000_000) {
  throw new Error("Familiar character plans must be 1 MB or smaller.");
}

const result = prepareFamiliarCharacterHandoff(JSON.parse(await readFile(inputFile, "utf8")));
if (result.payload.status === "complete") {
  const nativeJson = `${JSON.stringify(result.payload.nativeDraft, null, 2)}\n`;
  const contentHash = `sha256:${createHash("sha256").update(nativeJson).digest("hex")}`;
  if (Buffer.byteLength(nativeJson) > 1_000_000 || result.payload.contentHash !== contentHash) {
    throw new Error("The VTT produced an invalid or oversized native character draft.");
  }
  await writeFile(outputFile, nativeJson, { encoding: "utf8", flag: "wx" });
}

const resultJson = `${JSON.stringify(result, null, 2)}\n`;
if (Buffer.byteLength(resultJson) > 2_000_000) throw new Error("The VTT player-character result envelope is too large.");
process.stdout.write(resultJson);
if (result.payload.status !== "complete") process.exitCode = 2;
