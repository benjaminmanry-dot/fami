import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

const sourceDirectory = resolve(process.argv[2] ?? "");
const outputFile = resolve(process.argv[3] ?? "corpus/assistant-corpus.sql");
const helpFile = process.argv[4] ? resolve(process.argv[4]) : null;
const maxChunkCharacters = 3_500;

if (!process.argv[2]) {
  throw new Error("Pass the extracted Markdown directory as the first argument.");
}

const files = (await markdownFiles(sourceDirectory)).sort();
if (!files.length) throw new Error(`No Markdown files found in ${sourceDirectory}`);

const hash = createHash("sha256");
const chunks = [];
const sources = files.map((file) => ({ file, relativePath: relative(sourceDirectory, file).split(sep).join("/") }));
if (helpFile) sources.push({ file: helpFile, relativePath: "Player Help/20Fates VTT.md" });
for (const { file, relativePath } of sources) {
  const markdown = (await readFile(file, "utf8")).replaceAll("\0", "");
  hash.update(relativePath).update("\0").update(markdown).update("\0");
  chunks.push(...chunkDocument(relativePath, markdown));
}

const statements = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS assistant_corpus USING fts5(
    source UNINDEXED,
    section,
    audience UNINDEXED,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );`,
  `CREATE TABLE IF NOT EXISTS assistant_corpus_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    source_hash TEXT NOT NULL,
    file_count INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS assistant_usage (
    day TEXT NOT NULL,
    room_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    questions INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, room_id, client_id)
  );`,
  "DELETE FROM assistant_corpus;",
  "DELETE FROM assistant_corpus_meta;",
];

for (let index = 0; index < chunks.length; index += 20) {
  const values = chunks.slice(index, index + 20).map((chunk) =>
    `('${sql(chunk.source)}','${sql(chunk.section)}','${chunk.audience}','${sql(chunk.content)}')`,
  );
  statements.push(`INSERT INTO assistant_corpus (source, section, audience, content) VALUES\n${values.join(",\n")};`);
}

const sourceHash = hash.digest("hex");
statements.push(`INSERT INTO assistant_corpus_meta (id, source_hash, file_count, chunk_count)
VALUES (1, '${sourceHash}', ${sources.length}, ${chunks.length});`);

await writeFile(outputFile, `${statements.join("\n--> statement-breakpoint\n")}\n`, "utf8");
console.log(JSON.stringify({ outputFile, files: sources.length, corpusFiles: files.length, chunks: chunks.length, sourceHash }));

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? [path] : [];
  }));
  return nested.flat();
}

function chunkDocument(relativePath, markdown) {
  const source = basename(relativePath, ".md");
  const headings = [];
  const sections = [];
  let lines = [];
  let section = "Overview";

  function flush() {
    const content = cleanMarkdown(lines.join("\n"));
    if (!content) return;
    for (const part of splitContent(content)) {
      sections.push({ source, section, audience: audienceFor(relativePath, section), content: part });
    }
  }

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) {
      lines.push(line);
      continue;
    }
    flush();
    const level = match[1].length;
    headings.length = level;
    headings[level - 1] = match[2].trim();
    section = headings.filter(Boolean).join(" > ").slice(0, 500) || "Overview";
    lines = [line];
  }
  flush();
  return sections;
}

function cleanMarkdown(markdown) {
  return markdown
    .replace(/^!\[[^\]]*\]\([^\n]+\)\s*$/gm, "")
    .replace(/<!--[^]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitContent(content) {
  if (content.length <= maxChunkCharacters) return [content];
  const chunks = [];
  let current = "";
  for (const block of content.split(/\n{2,}/)) {
    if (block.length > maxChunkCharacters) {
      if (current) chunks.push(current);
      chunks.push(...splitLongBlock(block));
      current = "";
    } else if (!current || current.length + block.length + 2 <= maxChunkCharacters) {
      current += `${current ? "\n\n" : ""}${block}`;
    } else {
      chunks.push(current);
      current = block;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitLongBlock(block) {
  const chunks = [];
  let rest = block;
  while (rest.length > maxChunkCharacters) {
    const window = rest.slice(0, maxChunkCharacters + 1);
    const splitAt = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const end = splitAt > maxChunkCharacters * 0.65 ? splitAt : maxChunkCharacters;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function audienceFor(relativePath, section) {
  const path = relativePath.toLowerCase();
  const heading = section.toLowerCase();
  if (path.startsWith("player help/")) return "player";
  if (path.startsWith("adventures/") || path.includes("/adventures/") ||
    path.startsWith("reference material/") || path.includes("/reference material/")) return "dm";
  if (/dungeon master's|monster manual|screen|menagerie|monstrous|villainy|thieves' gallery/.test(path)) return "dm";
  if (/player's handbook|sage advice|tasha's|xanathar's|heroes of faer|forge of the artificer|sword coast adventurer|astral adventurer/.test(path)) return "player";
  return /character|player option|species|lineage|race|subclass|background|feat|spell|equipment/.test(heading) ? "player" : "dm";
}

function sql(value) {
  return value.replaceAll("'", "''");
}
