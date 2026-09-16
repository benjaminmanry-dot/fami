"""Build a proof or final one-shot adventure PDF from markdown sources.

Usage:
    python build_one_shot_pdf.py <adventure_dir> [options]

The adventure folder (typically one-shots/<slug>/) supplies:

    adventure.json                  adventure metadata (schema below)
    one_shot_packet.md              the module manuscript (required)
    one_shot_dm_running_notes.md    legacy appendix (explicit --notes only)
    roll20_setup_manifest.md        standalone working file (see --roll20)

Input filenames can be overridden with --packet / --notes / --roll20 /
--config. A legacy DM running-notes appendix is included only when --notes
is explicitly passed; the canonical table reader is the packet itself.
The Roll20 setup manifest is a
standalone working file, excluded from the deliverable PDF unless
explicitly requested: it is appended ONLY when --roll20 is passed on the
command line (it is never auto-detected, and a missing file is then an
error).

adventure.json schema -- proof requires only "title"; final requires title,
subtitle, level, party, runtime, tone, and themes:

    {
      "title": "The Adventure Title",
      "subtitle": "A 4-hour 5e adventure for 5th-level characters",
      "cover_mark": "small-caps line above the title",
      "cover_tagline": "one line of cover flavor",
      "level": "5",
      "party": "4-5",
      "runtime": "4 hours",
      "tone": "Two or three words",
      "themes": "Plain-language themes and content register",
      "running_title": "Optional short footer title",
      "product_note": "legal/branding line for the cover foot",
      "quickstart": "DM Quickstart callout text",
      "trackers": ["Tracker one 0-5", "Tracker two 0-4"],
      "visual_profile": {
        "accent": "#4b2937",
        "accent_alt": "#a4793e",
        "paper": "#f7f2e7",
        "ink": "#211d19"
      },
      "art_slots": [
        {
          "title": "Site Map",
          "filename": "assets/map-01.png",
          "purpose": "...",
          "approved": true,
          "required": false,
          "placement": "appendix"
        }
      ]
    }

If adventure.json is missing, the title falls back to the packet's first
"# " heading and every optional cover element is simply omitted.

Outputs are written ONLY inside <adventure_dir>/<out-subdir>/ (default
"pdf"). Proof output uses a ``-proof`` filename suffix; final output keeps
the plain title slug. A Contents page is emitted directly after the cover,
built from packet H2 headings plus appendix headings; each entry is an
internal anchor link. Approved local PNG/JPEG/WebP/GIF assets can be embedded
from paths inside the adventure folder. Missing assets are labeled in proof
mode; final mode omits optional missing assets and rejects required ones.

PDF rendering uses local headless Chrome or Edge. Proof mode degrades to
HTML+CSS plus a TODO when no renderer is available. Final mode additionally
requires a local ``pdftoppm`` page renderer and rejects near-blank pages.
These objective checks do not replace fresh-context visual inspection.
"""

from __future__ import annotations

import argparse
import base64
import datetime as _dt
import html
import json
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]

DEFAULT_PRODUCT_NOTE = "Original adventure layout. Not official branding or trade dress."
FINAL_REQUIRED_META = ("title", "subtitle", "level", "party", "runtime", "tone", "themes")
VISUAL_PROFILE_KEYS = {
    "accent": "--accent",
    "accent_alt": "--accent-alt",
    "paper": "--paper",
    "ink": "--ink",
}
IMAGE_TYPES = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
PLACEHOLDER_PATTERNS = (
    ("angle-bracket template token", re.compile(r"<[^>\n]{2,80}>")),
    ("double-brace template token", re.compile(r"\{\{[^}\n]+\}\}")),
    ("bracketed work token", re.compile(r"\[(?:TODO|TBD|FIXME|PLACEHOLDER|INSERT)[^\]]*\]", re.IGNORECASE)),
    ("unfinished work token", re.compile(r"\b(?:TODO|TBD|FIXME|PLACEHOLDER)\b", re.IGNORECASE)),
    ("template instructions", re.compile(r"\bTemplate instructions\b", re.IGNORECASE)),
    ("template shorthand", re.compile(r"^\s*Same format\.\s*$", re.IGNORECASE | re.MULTILINE)),
)


@dataclass
class Meta:
    title: str
    subtitle: str = ""
    cover_mark: str = ""
    cover_tagline: str = ""
    level: str = ""
    party: str = ""
    runtime: str = ""
    tone: str = ""
    themes: str = ""
    running_title: str = ""
    product_note: str = DEFAULT_PRODUCT_NOTE
    quickstart: str = ""
    trackers: list[str] = field(default_factory=list)
    art_slots: list[dict] = field(default_factory=list)
    visual_profile: dict[str, str] = field(default_factory=dict)


@dataclass
class BuildResult:
    html_path: Path
    css_path: Path
    pdf_path: Path
    manifest_path: Path
    rendered_pdf: bool
    renderer: str
    mode: str
    objective_status: str = "NOT RUN"
    objective_notes: list[str] = field(default_factory=list)
    rendered_pages: int = 0
    warning: str = ""


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return slug or "section"


def resolve_inside(root: Path, user_path: str | Path, label: str, *, descendant: bool = False) -> Path:
    """Resolve a user-controlled path and keep it inside the adventure folder."""
    root = root.resolve()
    candidate = (root / Path(user_path)).resolve()
    try:
        relative = candidate.relative_to(root)
    except ValueError:
        raise SystemExit(f"{label} must stay inside the adventure folder: {user_path}") from None
    if descendant and relative == Path("."):
        raise SystemExit(f"{label} must be a subfolder inside the adventure folder.")
    return candidate


def css_string(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"').replace("\r", " ").replace("\n", " ")


def select_proof_sections(markdown: str, requested: list[str]) -> str:
    """Keep the packet prelude and explicitly selected H2 sections for a small proof."""
    if not requested:
        return markdown
    lines = markdown.splitlines()
    starts = [i for i, line in enumerate(lines) if re.match(r"^##\s+\S", line.strip())]
    if not starts:
        raise SystemExit("--proof-section was used, but the packet has no H2 sections.")
    wanted = {slugify(item) for item in requested}
    selected: list[str] = lines[: starts[0]]
    found: set[str] = set()
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(lines)
        heading = re.sub(r"^##\s+", "", lines[start].strip())
        heading_slug = slugify(heading)
        matches = {needle for needle in wanted if needle == heading_slug or needle in heading_slug}
        if matches:
            selected.extend(lines[start:end])
            found.update(matches)
    missing = sorted(wanted - found)
    if missing:
        raise SystemExit("Proof section not found: " + ", ".join(missing))
    return "\n".join(selected).rstrip() + "\n"


def omit_rendered_cover_section(markdown: str) -> str:
    """Metadata renders the cover; do not repeat the manuscript's Cover block in the body."""
    lines = markdown.splitlines()
    start = next((i for i, line in enumerate(lines) if re.fullmatch(r"##\s+Cover\s*", line, re.IGNORECASE)), None)
    if start is None:
        return markdown
    end = next((i for i in range(start + 1, len(lines)) if re.match(r"^##\s+\S", lines[i].strip())), len(lines))
    return "\n".join(lines[:start] + lines[end:]).rstrip() + "\n"


def unresolved_tokens(named_texts: list[tuple[str, str]]) -> list[str]:
    findings: list[str] = []
    for label, text in named_texts:
        for description, pattern in PLACEHOLDER_PATTERNS:
            match = pattern.search(text)
            if match:
                token = re.sub(r"\s+", " ", match.group(0)).strip()
                findings.append(f"{label}: {description} `{token[:80]}`")
    return findings


def validate_final_inputs(meta: Meta, config_exists: bool, named_texts: list[tuple[str, str]]) -> None:
    if not config_exists:
        raise SystemExit("Final mode requires adventure.json (or an explicit --config file).")
    missing = [name for name in FINAL_REQUIRED_META if not str(getattr(meta, name, "")).strip()]
    if missing:
        raise SystemExit("Final metadata is missing: " + ", ".join(missing))
    findings = unresolved_tokens(named_texts)
    if findings:
        raise SystemExit("Final build contains unresolved template or placeholder text:\n- " + "\n- ".join(findings))


def find_renderer() -> Path | None:
    for candidate in CHROME_CANDIDATES:
        path = Path(candidate)
        if path.exists():
            return path
    for name in ("chrome", "chromium", "msedge"):
        found = shutil.which(name)
        if found:
            return Path(found)
    return None


def find_page_renderer() -> Path | None:
    found = shutil.which("pdftoppm")
    if not found:
        return None
    path = Path(found)
    if path.suffix.lower() == ".cmd" and len(path.parents) > 2:
        bundled = path.parents[2] / "native" / "poppler" / "Library" / "bin" / "pdftoppm.exe"
        if bundled.is_file():
            return bundled
    return path


def inline_markup(text: str) -> str:
    escaped = html.escape(text)
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", escaped)
    return escaped


def is_table_delimiter(line: str) -> bool:
    stripped = line.strip()
    if not stripped.startswith("|") or not stripped.endswith("|"):
        return False
    cells = [cell.strip() for cell in stripped.strip("|").split("|")]
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell or "") for cell in cells)


def parse_table(lines: list[str], start: int) -> tuple[str, int]:
    header = [cell.strip() for cell in lines[start].strip().strip("|").split("|")]
    rows: list[list[str]] = []
    i = start + 2
    while i < len(lines) and lines[i].strip().startswith("|") and lines[i].strip().endswith("|"):
        rows.append([cell.strip() for cell in lines[i].strip().strip("|").split("|")])
        i += 1
    out = ["<div class=\"table-wrap\"><table>"]
    out.append("<thead><tr>" + "".join(f"<th>{inline_markup(cell)}</th>" for cell in header) + "</tr></thead>")
    out.append("<tbody>")
    for row in rows:
        padded = row + [""] * max(0, len(header) - len(row))
        out.append("<tr>" + "".join(f"<td>{inline_markup(cell)}</td>" for cell in padded[: len(header)]) + "</tr>")
    out.append("</tbody></table></div>")
    return "\n".join(out), i


def flush_paragraph(out: list[str], paragraph: list[str]) -> None:
    if paragraph:
        text = " ".join(item.strip() for item in paragraph if item.strip())
        if text:
            out.append(f"<p>{inline_markup(text)}</p>")
        paragraph.clear()


def bind_section_leads(blocks: list[str]) -> list[str]:
    """Keep each H2 with enough opening material to avoid a stranded section heading."""
    bound: list[str] = []
    i = 0
    while i < len(blocks):
        if not blocks[i].startswith("<h2"):
            bound.append(blocks[i])
            i += 1
            continue
        heading = blocks[i]
        i += 1
        body: list[str] = []
        if i < len(blocks) and not blocks[i].startswith("<h2") and blocks[i] not in {"<ul>", "<ol>"}:
            body.append(blocks[i])
            i += 1
            if (
                len(re.sub(r"<[^>]+>", "", body[0])) <= 180
                and i < len(blocks)
                and blocks[i].startswith(("<p>", "<blockquote>"))
            ):
                body.append(blocks[i])
                i += 1
        body_html = ""
        if body:
            visible = len(re.sub(r"<[^>]+>", "", " ".join(body)))
            balance = visible >= 320 and all(block.startswith("<p>") for block in body)
            body_class = "section-lead-body balanced" if balance else "section-lead-body"
            body_html = f'<div class="{body_class}">' + "\n".join(body) + "</div>"
        bound.append('<div class="section-lead">' + heading + body_html + "</div>")
    return bound


def markdown_to_html(markdown: str) -> str:
    lines = markdown.splitlines()
    out: list[str] = []
    paragraph: list[str] = []
    list_open = False
    blockquote: list[str] = []
    in_code = False
    code_lines: list[str] = []
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_paragraph(out, paragraph)
            if not in_code:
                in_code = True
                code_lines = []
            else:
                out.append("<pre><code>" + html.escape("\n".join(code_lines)) + "</code></pre>")
                in_code = False
            i += 1
            continue

        if in_code:
            code_lines.append(line)
            i += 1
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and is_table_delimiter(lines[i + 1]):
            flush_paragraph(out, paragraph)
            if list_open:
                out.append("</ul>")
                list_open = False
            table_html, next_i = parse_table(lines, i)
            out.append(table_html)
            i = next_i
            continue

        if stripped.startswith(">"):
            flush_paragraph(out, paragraph)
            blockquote.append(stripped.lstrip(">").strip())
            i += 1
            if i >= len(lines) or not lines[i].strip().startswith(">"):
                out.append("<blockquote>" + " ".join(inline_markup(part) for part in blockquote) + "</blockquote>")
                blockquote = []
            continue

        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading:
            flush_paragraph(out, paragraph)
            if list_open:
                out.append("</ul>")
                list_open = False
            level = len(heading.group(1))
            text = heading.group(2).strip()
            css = ""
            if level == 1:
                css = " class=\"packet-title\""
            elif level == 2:
                css = " class=\"section-title\""
            elif level == 3:
                css = " class=\"subsection-title\""
            out.append(f"<h{level}{css} id=\"{slugify(text)}\">{inline_markup(text)}</h{level}>")
            i += 1
            continue

        if stripped.startswith("- "):
            flush_paragraph(out, paragraph)
            if not list_open:
                out.append("<ul>")
                list_open = True
            out.append(f"<li>{inline_markup(stripped[2:].strip())}</li>")
            i += 1
            continue

        numbered = re.match(r"^\d+\.\s+(.*)$", stripped)
        if numbered:
            flush_paragraph(out, paragraph)
            if not list_open:
                out.append("<ol>")
                list_open = "ol"  # type: ignore[assignment]
            out.append(f"<li>{inline_markup(numbered.group(1).strip())}</li>")
            i += 1
            next_line = lines[i].strip() if i < len(lines) else ""
            if not re.match(r"^\d+\.\s+", next_line):
                out.append("</ol>")
                list_open = False
            continue

        if stripped == "":
            flush_paragraph(out, paragraph)
            if list_open:
                out.append("</ul>")
                list_open = False
            i += 1
            continue

        paragraph.append(stripped)
        i += 1

    flush_paragraph(out, paragraph)
    if list_open:
        out.append("</ul>")
    if in_code:
        out.append("<pre><code>" + html.escape("\n".join(code_lines)) + "</code></pre>")
    return "\n".join(bind_section_leads(out))


def callout(title: str, body_lines: list[str], kind: str = "note") -> str:
    body = "".join(f"<p>{inline_markup(line)}</p>" for line in body_lines if line.strip())
    return f"<aside class=\"callout {kind}\"><h3>{html.escape(title)}</h3>{body}</aside>"


def proof_art_slot(title: str, filename: str, purpose: str, reason: str) -> str:
    return (
        "<div class=\"art-slot proof-only\">"
        "<div class=\"art-icon\">!</div>"
        f"<p class=\"proof-label\">Proof only — {html.escape(reason)}</p>"
        f"<h4>{html.escape(title)}</h4>"
        f"<p><strong>Local file:</strong> <code>{html.escape(filename or 'not specified')}</code></p>"
        f"<p>{inline_markup(purpose)}</p>"
        "</div>"
    )


def embedded_asset(title: str, purpose: str, filename: str, data_uri: str, *, cover: bool) -> str:
    alt = title or purpose or filename
    if cover:
        return (
            "<figure class=\"cover-visual\">"
            f"<img src=\"{data_uri}\" alt=\"{html.escape(alt)}\">"
            + (f"<figcaption>{inline_markup(purpose)}</figcaption>" if purpose else "")
            + "</figure>"
        )
    return (
        "<figure class=\"asset-card\">"
        f"<img src=\"{data_uri}\" alt=\"{html.escape(alt)}\">"
        f"<figcaption><strong>{html.escape(title)}</strong>"
        f"<span>{inline_markup(purpose)}</span><code>{html.escape(filename)}</code></figcaption>"
        "</figure>"
    )


def prepare_assets(meta: Meta, source_dir: Path, mode: str) -> tuple[str, str, list[str]]:
    cover_html = ""
    appendix_cards: list[str] = []
    notes: list[str] = []
    required_errors: list[str] = []
    cover_count = 0
    for index, slot in enumerate(meta.art_slots, start=1):
        if not isinstance(slot, dict):
            raise SystemExit(f"art_slots entry {index} must be an object.")
        title = str(slot.get("title", f"Asset {index}")).strip() or f"Asset {index}"
        filename = str(slot.get("filename", "")).strip()
        purpose = str(slot.get("purpose", "")).strip()
        approved = slot.get("approved") is True
        required = slot.get("required") is True
        placement = str(slot.get("placement", "appendix")).strip().lower()
        if placement not in {"appendix", "cover"}:
            raise SystemExit(f"Asset {title!r} has invalid placement {placement!r}; use cover or appendix.")
        if placement == "cover":
            cover_count += 1
            if cover_count > 1:
                raise SystemExit("Only one art_slots entry may use placement \"cover\".")

        path = resolve_inside(source_dir, filename, f"Asset {title!r}") if filename else None
        exists = bool(path and path.is_file())
        suffix = path.suffix.lower() if path else ""
        supported = suffix in IMAGE_TYPES
        usable = approved and exists and supported

        if usable and path:
            data_uri = f"data:{IMAGE_TYPES[suffix]};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"
            card = embedded_asset(title, purpose, filename, data_uri, cover=placement == "cover")
            if placement == "cover":
                cover_html = card
            else:
                appendix_cards.append(card)
            notes.append(f"Embedded approved asset: {filename}")
            continue

        if not approved:
            reason = "asset not approved"
        elif not exists:
            reason = "asset file missing"
        else:
            reason = f"unsupported image type {suffix or '(none)'}"
        if mode == "proof":
            card = proof_art_slot(title, filename, purpose, reason)
            if placement == "cover":
                cover_html = card
            else:
                appendix_cards.append(card)
            notes.append(f"Proof label: {title} ({reason})")
        elif required:
            required_errors.append(f"{title}: {reason}")
        else:
            notes.append(f"Omitted optional asset: {title} ({reason})")

    if required_errors:
        raise SystemExit("Final build is missing required approved assets:\n- " + "\n- ".join(required_errors))
    appendix_html = ""
    if appendix_cards:
        appendix_html = (
            "    <section class=\"appendix\">\n"
            "      <h2 class=\"section-title\" id=\"maps-and-art\">Maps and Art</h2>\n"
            "      <div class=\"asset-grid\">\n        "
            + "\n        ".join(appendix_cards)
            + "\n      </div>\n    </section>\n"
        )
    return cover_html, appendix_html, notes


def build_cover(meta: Meta, mode: str, cover_asset_html: str) -> str:
    parts = ["  <section class=\"cover page-break-after\">"]
    if mode == "proof":
        parts.append("    <div class=\"proof-banner\">Internal layout proof — not final</div>")
    if meta.cover_mark:
        parts.append(f"    <div class=\"cover-mark\">{html.escape(meta.cover_mark)}</div>")
    parts.append(f"    <h1>{html.escape(meta.title)}</h1>")
    if meta.subtitle:
        parts.append(f"    <p class=\"subtitle\">{html.escape(meta.subtitle)}</p>")
    facts = [("Level", meta.level), ("Party", meta.party), ("Runtime", meta.runtime), ("Tone", meta.tone)]
    facts = [(label, value) for label, value in facts if value]
    if facts:
        parts.append("    <div class=\"cover-grid\">")
        for label, value in facts:
            parts.append(f"      <div><span>{html.escape(label)}</span><strong>{html.escape(value)}</strong></div>")
        parts.append("    </div>")
    if cover_asset_html:
        parts.append("    " + cover_asset_html)
    elif meta.cover_tagline:
        parts.append(f"    <div class=\"cover-focus\"><p>{html.escape(meta.cover_tagline)}</p></div>")
    if meta.themes:
        parts.append(f"    <p class=\"themes\"><strong>Themes:</strong> {html.escape(meta.themes)}</p>")
    if meta.product_note:
        parts.append(f"    <p class=\"product-note\">{html.escape(meta.product_note)}</p>")
    parts.append("  </section>")
    return "\n".join(parts)


def build_frontmatter(meta: Meta) -> str:
    callouts = []
    if meta.quickstart:
        callouts.append(callout("DM Quickstart", [meta.quickstart], "important"))
    if meta.trackers:
        callouts.append(callout("Core Trackers", meta.trackers, "tracker"))
    if not callouts:
        return ""
    inner = "\n        ".join(callouts)
    return (
        "    <section class=\"frontmatter\">\n"
        "      <div class=\"two-col\">\n"
        f"        {inner}\n"
        "      </div>\n"
        "    </section>\n"
    )


def toc_entries(packet_md: str, appendices: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Collect (heading text, anchor id) pairs: packet H2s, then appendix titles.

    Anchors match the ids markdown_to_html assigns (slugify of the heading
    text); appendix headings get the same slugified ids in build_html.
    """
    entries: list[tuple[str, str]] = []
    in_code = False
    for line in packet_md.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        match = re.match(r"^##\s+(.+)$", stripped)
        if match:
            text = match.group(1).strip()
            entries.append((text, slugify(text)))
    for heading, _body in appendices:
        entries.append((heading, slugify(heading)))
    return entries


def build_toc(entries: list[tuple[str, str]]) -> str:
    if not entries:
        return ""
    items = "\n".join(
        f"        <li><a href=\"#{anchor}\">{inline_markup(text)}</a></li>"
        for text, anchor in entries
    )
    return (
        "    <section class=\"toc\">\n"
        "      <h2 class=\"section-title\">Contents</h2>\n"
        "      <ol class=\"toc-list\">\n"
        f"{items}\n"
        "      </ol>\n"
        "    </section>\n"
    )


def build_html(
    meta: Meta,
    packet_html: str,
    appendices: list[tuple[str, str]],
    css_name: str,
    toc_html: str,
    mode: str,
    cover_asset_html: str,
    asset_appendix_html: str,
) -> str:
    appendix_html = ""
    for heading, body in appendices:
        appendix_html += (
            "    <section class=\"appendix\">\n"
            f"      <h2 class=\"section-title\" id=\"{slugify(heading)}\">{html.escape(heading)}</h2>\n"
            f"      <div class=\"notes-block\">{body}</div>\n"
            "    </section>\n"
        )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(meta.title)}</title>
  <link rel="stylesheet" href="{html.escape(css_name)}">
</head>
<body>
{build_cover(meta, mode, cover_asset_html)}

  <main>
{toc_html}{build_frontmatter(meta)}
    <article class="module-content">
      {packet_html}
    </article>

{appendix_html}{asset_appendix_html}  </main>
</body>
</html>
"""


CSS = r"""
:root {
  --paper: #f7f2e7;
  --paper-deep: #ede3d1;
  --ink: #211d19;
  --muted: #655e54;
  --accent: #4b2937;
  --accent-alt: #a4793e;
  --line: #cdbf9f;
}

@page {
  size: Letter;
  margin: 0.58in 0.55in 0.68in;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--paper-deep);
  color: var(--ink);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 10.4pt;
  line-height: 1.42;
}

p { margin: 0 0 0.55rem; }
ul, ol { margin: 0 0 0.65rem 1.05rem; padding: 0; }
p { orphans: 3; widows: 3; }
li { margin-bottom: 0.16rem; break-inside: avoid; orphans: 3; widows: 3; }
code {
  font-family: Consolas, "Courier New", monospace;
  font-size: 0.88em;
  background: #eee3cf;
  padding: 0.05rem 0.2rem;
  border-radius: 3px;
}
pre {
  white-space: pre-wrap;
  background: #f2eadc;
  border-left: 4px solid var(--accent-alt);
  padding: 0.6rem 0.75rem;
  break-inside: avoid;
}

.cover {
  min-height: 9.75in;
  padding: 0.72in 0.62in;
  color: var(--ink);
  background:
    linear-gradient(135deg, rgba(75,41,55,0.08), transparent 48%),
    linear-gradient(150deg, var(--paper) 0%, var(--paper-deep) 100%);
  border: 12px solid var(--accent);
  outline: 4px solid var(--accent-alt);
  outline-offset: -28px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.cover-mark {
  color: var(--accent);
  font-family: Arial, sans-serif;
  font-size: 9pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  border-bottom: 2px solid var(--accent-alt);
  padding-bottom: 0.16in;
}
.cover h1 {
  font-size: 44pt;
  line-height: 0.98;
  margin: 0.25in 0 0.1in;
  color: var(--ink);
}
.subtitle {
  font-size: 15pt;
  max-width: 6.4in;
  color: var(--muted);
}
.cover-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(1.4in, 1fr));
  gap: 0.12in;
  margin: 0.32in 0;
}
.cover-grid div {
  border: 1.5px solid color-mix(in srgb, var(--accent) 65%, transparent);
  background: rgba(255,255,255,0.45);
  padding: 0.12in;
}
.cover-grid span {
  display: block;
  font-family: Arial, sans-serif;
  font-size: 7.5pt;
  color: var(--muted);
  text-transform: uppercase;
}
.cover-grid strong {
  display: block;
  margin-top: 0.04in;
  font-size: 12pt;
}
.cover-focus {
  min-height: 1.55in;
  border-top: 3px solid var(--accent);
  border-bottom: 1px solid var(--accent-alt);
  padding: 0.3in 0.18in;
  display: flex;
  align-items: center;
  background: rgba(255,255,255,0.3);
}
.cover-focus p {
  margin: 0;
  font-family: Arial, sans-serif;
  font-size: 12pt;
  line-height: 1.45;
  letter-spacing: 0.02em;
}
.cover-visual {
  margin: 0;
  max-height: 3.1in;
  overflow: hidden;
  border: 2px solid var(--accent);
  background: var(--paper-deep);
}
.cover-visual img {
  display: block;
  width: 100%;
  max-height: 2.65in;
  object-fit: cover;
}
.cover-visual figcaption {
  padding: 0.08in 0.12in;
  font-family: Arial, sans-serif;
  font-size: 8pt;
}
.proof-banner {
  color: #fff;
  background: var(--accent);
  padding: 0.07in 0.12in;
  font-family: Arial, sans-serif;
  font-size: 8pt;
  font-weight: bold;
  letter-spacing: 0.12em;
  text-align: center;
  text-transform: uppercase;
}
.themes {
  border-left: 3px solid var(--accent-alt);
  padding-left: 0.12in;
}
.product-note {
  font-family: Arial, sans-serif;
  font-size: 8.5pt;
  color: #4f412c;
}

main {
  background: var(--paper);
}

.module-content,
.appendix,
.frontmatter {
  padding: 0.08in 0 0;
}

.packet-title {
  display: none;
}
.section-title {
  font-size: 20pt;
  line-height: 1.08;
  color: var(--accent);
  border-top: 4px solid var(--accent-alt);
  border-bottom: 1px solid var(--line);
  padding: 0.12in 0 0.06in;
  margin: 0.18in 0 0.12in;
  break-after: avoid-page;
  page-break-after: avoid;
}
.subsection-title {
  font-size: 13pt;
  color: var(--accent);
  margin: 0.16in 0 0.06in;
  break-after: avoid-page;
  page-break-after: avoid;
}
h4, h5, h6 {
  font-family: Arial, sans-serif;
  color: var(--accent);
  margin: 0.12in 0 0.04in;
  break-after: avoid-page;
  page-break-after: avoid;
}

.module-content {
  column-count: 2;
  column-gap: 0.28in;
}
.module-content > .section-lead,
.module-content > .table-wrap,
.module-content > pre,
.module-content > blockquote {
  column-span: all;
}
.section-lead {
  break-inside: avoid-page;
  break-after: avoid-page;
  min-height: 0.65in;
}
.section-lead-body {
  column-count: 1;
}
.section-lead-body.balanced {
  column-count: 2;
  column-gap: 0.28in;
}
.section-lead-body > :first-child {
  margin-top: 0;
}
.module-content > h3 {
  break-after: avoid-page;
  page-break-after: avoid;
}
.module-content > h3:has(+ .table-wrap) {
  column-span: all;
}

.toc {
  padding: 0.08in 0 0;
}
.toc-list {
  list-style: none;
  margin: 0.08in 0 0;
  padding: 0;
  font-family: Arial, sans-serif;
  font-size: 10.5pt;
}
.toc-list li {
  border-bottom: 1px dotted var(--line);
  padding: 0.055in 0;
}
.toc-list a {
  color: var(--ink);
  text-decoration: none;
}

.frontmatter .two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.18in;
}

.callout,
blockquote {
  background: #f2eadc;
  border-left: 5px solid var(--accent-alt);
  padding: 0.12in 0.14in;
  margin: 0 0 0.12in;
  break-inside: avoid;
}
.callout h3 {
  margin: 0 0 0.05in;
  font-family: Arial, sans-serif;
  font-size: 10.5pt;
  text-transform: uppercase;
  color: var(--accent);
}
.callout.important { border-left-color: var(--accent); }
.callout.tracker { border-left-color: var(--accent-alt); }

.table-wrap {
  margin: 0.08in 0 0.14in;
  break-inside: avoid;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-family: Arial, sans-serif;
  font-size: 8.2pt;
  line-height: 1.24;
}
th {
  background: var(--accent);
  color: #fff;
  text-align: left;
  padding: 0.055in;
  border: 1px solid var(--accent);
}
td {
  vertical-align: top;
  padding: 0.055in;
  border: 1px solid var(--line);
  background: #fffdf8;
}
tr:nth-child(even) td {
  background: #f5eee1;
}

.notes-block {
  column-count: 2;
  column-gap: 0.28in;
}
.notes-block h1,
.notes-block pre,
.notes-block blockquote {
  column-span: all;
}
.notes-block > .section-lead {
  column-span: none;
  min-height: 0;
}
.notes-block > .section-lead .section-lead-body {
  column-count: 1;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.16in;
  margin: 0.12in 0 0.2in;
}
.art-slot {
  min-height: 1.55in;
  border: 2px dashed var(--accent-alt);
  background: #f2eadc;
  padding: 0.12in;
  break-inside: avoid;
}
.art-slot .art-icon {
  float: right;
  width: 0.42in;
  height: 0.42in;
  border-radius: 50%;
  border: 2px solid var(--accent);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.art-slot h4 {
  margin-top: 0;
  font-size: 12pt;
}
.proof-label {
  color: var(--accent);
  font-family: Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: bold;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.asset-card {
  margin: 0;
  border: 1px solid var(--line);
  background: #fffdf8;
  break-inside: avoid;
}
.asset-card img {
  display: block;
  width: 100%;
  max-height: 4.4in;
  object-fit: contain;
  background: var(--paper-deep);
}
.asset-card figcaption {
  display: grid;
  gap: 0.04in;
  padding: 0.1in;
  font-family: Arial, sans-serif;
  font-size: 8.5pt;
}

.page-break-before { break-before: page; }
.page-break-after { break-after: page; }

strong { color: #3d2a12; }

@media screen {
  body {
    max-width: 8.5in;
    margin: 0 auto;
    box-shadow: 0 0 30px rgba(0,0,0,0.18);
  }
  main {
    padding: 0.55in;
  }
}
"""


def build_css(meta: Meta) -> str:
    overrides: list[str] = []
    for key, value in meta.visual_profile.items():
        if key not in VISUAL_PROFILE_KEYS:
            raise SystemExit(
                f"Unknown visual_profile key {key!r}; use: {', '.join(sorted(VISUAL_PROFILE_KEYS))}."
            )
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise SystemExit(f"visual_profile.{key} must be a six-digit hex color, not {value!r}.")
        overrides.append(f"  {VISUAL_PROFILE_KEYS[key]}: {value};")
    profile_css = ":root {\n" + "\n".join(overrides) + "\n}\n" if overrides else ""
    running_title = css_string(meta.running_title.strip() or meta.title)
    footer_css = f"""
@page {{
  @bottom-left {{
    content: "{running_title}";
    color: #655e54;
    font-family: Arial, sans-serif;
    font-size: 7.5pt;
  }}
  @bottom-right {{
    content: "Page " counter(page) " of " counter(pages);
    color: #655e54;
    font-family: Arial, sans-serif;
    font-size: 7.5pt;
  }}
}}
html {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
"""
    return CSS.strip() + "\n" + profile_css + footer_css.strip() + "\n"


def load_meta(config_path: Path, packet_md: str, config_explicit: bool) -> tuple[Meta, str]:
    """Return (meta, note-about-config-source)."""
    if config_path.exists():
        try:
            raw = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"Could not read config {config_path}: {exc}") from None
        if not isinstance(raw, dict):
            raise SystemExit(f"Config {config_path} must contain a JSON object.")
        title = str(raw.get("title", "")).strip()
        if not title:
            raise SystemExit(f"Config {config_path} has no \"title\". See the module docstring for the schema.")
        trackers = raw.get("trackers", [])
        art_slots = raw.get("art_slots", [])
        visual_profile = raw.get("visual_profile", {})
        if not isinstance(trackers, list):
            raise SystemExit(f"Config {config_path}: trackers must be a list.")
        if not isinstance(art_slots, list):
            raise SystemExit(f"Config {config_path}: art_slots must be a list.")
        if not isinstance(visual_profile, dict):
            raise SystemExit(f"Config {config_path}: visual_profile must be an object.")
        meta = Meta(
            title=title,
            subtitle=str(raw.get("subtitle", "")),
            cover_mark=str(raw.get("cover_mark", "")),
            cover_tagline=str(raw.get("cover_tagline", "")),
            level=str(raw.get("level", "")),
            party=str(raw.get("party", "")),
            runtime=str(raw.get("runtime", "")),
            tone=str(raw.get("tone", "")),
            themes=str(raw.get("themes", "")),
            running_title=str(raw.get("running_title", "")),
            product_note=str(raw.get("product_note", DEFAULT_PRODUCT_NOTE)),
            quickstart=str(raw.get("quickstart", "")),
            trackers=[str(t) for t in trackers],
            art_slots=art_slots,
            visual_profile={str(key): str(value) for key, value in visual_profile.items()},
        )
        return meta, f"`{config_path.name}`"
    if config_explicit:
        raise SystemExit(f"Config file not found: {config_path}")
    match = re.search(r"^#\s+(.+)$", packet_md, flags=re.MULTILINE)
    title = match.group(1).strip() if match else "Untitled One-Shot"
    return Meta(title=title), "not present -- title taken from the packet's first heading"


def write_manifest(
    result: BuildResult,
    source_dir: Path,
    out_dir: Path,
    inputs: list[tuple[str, str]],
    config_note: str,
    toc: list[tuple[str, str]],
    build_notes: list[str],
) -> None:
    lines = [
        "# Build Manifest",
        "",
        f"- **Built:** {_dt.datetime.now().isoformat(timespec='seconds')}",
        f"- **Source folder:** `{source_dir}`",
        f"- **Output folder:** `{out_dir}`",
        f"- **Mode:** `{result.mode}`",
        f"- **Config:** {config_note}",
        "",
        "## Inputs",
        "",
    ]
    lines.extend(f"- {label}: {status}" for label, status in inputs)
    lines.extend([
        "",
        "## Outputs",
        "",
        f"- HTML: `{result.html_path.name}`",
        f"- CSS: `{result.css_path.name}`",
        f"- PDF: `{result.pdf_path.name}`" if result.rendered_pdf else "- PDF: not rendered",
        "",
        "## Status",
        "",
        f"- **Render:** {'SUCCEEDED' if result.rendered_pdf else 'FAILED OR UNAVAILABLE'}",
        f"- **Objective checks:** {result.objective_status}",
        (
            "- **Fresh-context visual approval:** PENDING — render success and objective checks are not visual approval."
            if result.rendered_pdf
            else "- **Fresh-context visual approval:** NOT READY — no PDF is available to inspect."
        ),
        "- A reviewer must inspect the actual PDF against `references/qa-panel.md` before anyone calls it final.",
        "",
        "## Build Notes",
        "",
    ])
    if build_notes or result.objective_notes:
        lines.extend(f"- {note}" for note in build_notes + result.objective_notes)
    else:
        lines.append("- None.")
    lines.extend([
        "",
        "## Table of Contents",
        "",
    ])
    if toc:
        lines.append(f"- Emitted after the cover with {len(toc)} internal links (packet H2 headings plus appendix headings):")
        lines.extend(f"  - {text}" for text, _anchor in toc)
    else:
        lines.append("- Not emitted: no H2 headings or appendices found.")
    lines.extend([
        "",
        "## Renderer",
        "",
    ])
    if result.rendered_pdf:
        lines.extend([
            f"- `{result.renderer}`",
            "- Invoked headless with --no-pdf-header-footer (no browser datestamp header or URL footer).",
        ])
    else:
        lines.extend([
            "- None used.",
            f"- Reason: {result.warning or 'No supported renderer found.'}",
            "- See `pdf_render_todo.md` for how to finish the render manually.",
        ])
    result.manifest_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_render_todo(path: Path, html_name: str, reason: str) -> None:
    path.write_text(
        "# PDF Render TODO\n\n"
        "The HTML and CSS were generated, but PDF rendering did not complete in this environment.\n\n"
        f"Reason: {reason}\n\n"
        f"Open `{html_name}` in a local Chrome/Chromium/Edge browser and print to PDF "
        "(disable the browser's headers and footers in the print dialog), or install a "
        "supported renderer such as Chrome headless.\n",
        encoding="utf-8",
    )


def render_pdf(renderer: Path, html_path: Path, pdf_path: Path) -> tuple[bool, str]:
    with tempfile.TemporaryDirectory(prefix="one-shot-pdf-") as user_data:
        cmd = [
            str(renderer),
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            f"--user-data-dir={user_data}",
            # Current flag; suppresses the datestamp header and URL/page footer.
            "--no-pdf-header-footer",
            # Legacy alias for older Chrome/Edge builds; unknown switches are ignored.
            "--print-to-pdf-no-header",
            f"--print-to-pdf={pdf_path}",
            html_path.resolve().as_uri(),
        ]
        try:
            completed = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except Exception as exc:  # pragma: no cover - environment dependent
            return False, str(exc)
    if completed.returncode != 0:
        return False, (completed.stderr or completed.stdout or f"Renderer exited {completed.returncode}").strip()
    if not pdf_path.exists() or pdf_path.stat().st_size < 1000:
        return False, "Renderer reported success but no usable PDF was created."
    return True, ""


def pgm_body_metrics(path: Path) -> tuple[float, float]:
    """Return body ink density and the share of horizontal bands carrying content."""
    data = path.read_bytes()
    header = re.match(br"P5\s+(\d+)\s+(\d+)\s+(\d+)\s", data)
    if not header:
        raise RuntimeError(f"Could not read rendered page image: {path.name}")
    width, height, maximum = (int(value) for value in header.groups())
    if maximum > 255:
        raise RuntimeError(f"Unsupported 16-bit rendered page image: {path.name}")
    pixels = data[header.end() :]
    if len(pixels) < width * height:
        raise RuntimeError(f"Rendered page image is truncated: {path.name}")
    x0, x1 = int(width * 0.06), int(width * 0.94)
    y0, y1 = int(height * 0.05), int(height * 0.86)
    threshold = int(maximum * 0.70)  # Ignore the parchment fields; count text, rules, and real image contrast.
    dark = total = used_bands = 0
    bands = 12
    for band in range(bands):
        start = y0 + (y1 - y0) * band // bands
        end = y0 + (y1 - y0) * (band + 1) // bands
        band_total = (end - start) * (x1 - x0)
        band_dark = sum(
            value < threshold
            for y in range(start, end)
            for value in pixels[y * width + x0 : y * width + x1]
        )
        dark += band_dark
        total += band_total
        used_bands += band_dark / band_total >= 0.01
    return (dark / total if total else 0.0), used_bands / bands


def check_rendered_pages(pdf_path: Path) -> tuple[int, list[str]]:
    page_renderer = find_page_renderer()
    if not page_renderer:
        raise RuntimeError("pdftoppm is unavailable; final page-by-page validation could not run.")
    with tempfile.TemporaryDirectory(prefix="one-shot-pages-") as folder:
        prefix = Path(folder) / "page"
        cmd = [str(page_renderer), "-gray", "-r", "36", str(pdf_path), str(prefix)]
        completed = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if completed.returncode != 0:
            raise RuntimeError((completed.stderr or completed.stdout or "pdftoppm failed").strip())
        pages = sorted(
            Path(folder).glob("page-*.pgm"),
            key=lambda path: int(path.stem.rsplit("-", 1)[1]),
        )
        if not pages:
            raise RuntimeError("Page renderer produced no page images.")
        metrics = [pgm_body_metrics(page) for page in pages]
    blank = [str(index + 1) for index, (ratio, _coverage) in enumerate(metrics) if ratio < 0.01]
    if blank:
        raise RuntimeError("Near-blank rendered page(s): " + ", ".join(blank))
    sparse = [str(index + 1) for index, (_ratio, coverage) in enumerate(metrics) if coverage <= 0.50]
    if sparse:
        raise RuntimeError("Rendered page(s) are majority blank: " + ", ".join(sparse))
    return len(pages), [
        f"Rendered all {len(pages)} PDF pages to images with pdftoppm.",
        "Near-blank and majority-blank screens passed; compositional judgment remains visual-review work.",
    ]


def read_optional(path: Path, explicit: bool, label: str) -> tuple[str, str]:
    """Return (markdown, manifest-status) for an optional input file."""
    if path.exists():
        return path.read_text(encoding="utf-8"), f"`{path.name}`"
    if explicit:
        raise SystemExit(f"{label} file not found: {path}")
    return "", "not present -- section skipped"


def build(args: argparse.Namespace) -> BuildResult:
    source_dir: Path = args.adventure_dir.resolve()
    if not source_dir.is_dir():
        raise SystemExit(f"Adventure folder not found: {source_dir}")
    mode: str = args.mode
    proof_sections: list[str] = args.proof_section or []
    if mode == "final" and proof_sections:
        raise SystemExit("--proof-section can only be used with --mode proof.")

    out_dir = resolve_inside(source_dir, args.out, "Output folder", descendant=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    packet_path = resolve_inside(source_dir, args.packet, "Packet file")
    if not packet_path.is_file():
        raise SystemExit(f"Packet file not found: {packet_path}")
    packet_source = packet_path.read_text(encoding="utf-8")

    notes_path = resolve_inside(source_dir, args.notes, "Running notes file")
    if args.notes_explicit:
        notes_md, notes_status = read_optional(notes_path, True, "Running notes")
        notes_status += " (included via --notes)"
    else:
        notes_md = ""
        notes_status = "excluded (--notes not passed)"
    # The Roll20 manifest is a standalone working file: never auto-detected,
    # included only when --roll20 is passed on the command line.
    roll20_path = resolve_inside(source_dir, args.roll20, "Roll20 manifest file")
    if args.roll20_explicit:
        if not roll20_path.is_file():
            raise SystemExit(f"Roll20 manifest file not found: {roll20_path}")
        roll20_md = roll20_path.read_text(encoding="utf-8")
        roll20_status = f"`{roll20_path.name}` (included via --roll20)"
    else:
        roll20_md = ""
        roll20_status = "excluded (--roll20 not passed)"
    config_path = resolve_inside(source_dir, args.config, "Config file")
    meta, config_note = load_meta(config_path, packet_source, args.config_explicit)

    metadata_text = json.dumps(meta.__dict__, ensure_ascii=False)
    if mode == "final":
        validate_final_inputs(
            meta,
            config_path.is_file(),
            [(packet_path.name, packet_source), (notes_path.name, notes_md), (roll20_path.name, roll20_md), (config_path.name, metadata_text)],
        )
    packet_md = select_proof_sections(packet_source, proof_sections) if mode == "proof" else packet_source
    if config_path.is_file():
        packet_md = omit_rendered_cover_section(packet_md)
    cover_asset_html, asset_appendix_html, asset_notes = prepare_assets(meta, source_dir, mode)

    slug = slugify(meta.title)
    output_slug = slug + ("-proof" if mode == "proof" else "")
    html_path = out_dir / f"{output_slug}.html"
    css_path = out_dir / f"{output_slug}.css"
    pdf_path = out_dir / f"{output_slug}.pdf"
    manifest_path = out_dir / "build_manifest.md"

    appendices: list[tuple[str, str]] = []
    if notes_md:
        appendices.append(("DM Running Notes", markdown_to_html(notes_md)))
    if roll20_md:
        appendices.append(("Roll20 Setup Appendix", markdown_to_html(roll20_md)))

    entries = toc_entries(packet_md, appendices)
    if asset_appendix_html:
        entries.append(("Maps and Art", "maps-and-art"))
    toc_html = build_toc(entries)

    css_path.write_text(build_css(meta), encoding="utf-8")
    rendered_html = build_html(
        meta,
        markdown_to_html(packet_md),
        appendices,
        css_path.name,
        toc_html,
        mode,
        cover_asset_html,
        asset_appendix_html,
    )
    html_path.write_text(rendered_html, encoding="utf-8")

    renderer = find_renderer()
    rendered = False
    warning = ""
    renderer_name = "none"
    if renderer:
        renderer_name = str(renderer)
        pdf_path.unlink(missing_ok=True)
        rendered, warning = render_pdf(renderer, html_path, pdf_path)
    else:
        warning = "No local Chrome/Chromium/Edge renderer found."

    result = BuildResult(
        html_path=html_path,
        css_path=css_path,
        pdf_path=pdf_path,
        manifest_path=manifest_path,
        rendered_pdf=rendered,
        renderer=renderer_name,
        mode=mode,
        warning=warning,
    )
    if mode == "proof":
        result.objective_status = "NOT RUN — proof mode"
    elif not rendered:
        result.objective_status = "FAILED — PDF did not render"
    else:
        try:
            result.rendered_pages, result.objective_notes = check_rendered_pages(pdf_path)
            result.objective_notes.insert(0, "Source and metadata placeholder scan passed.")
            result.objective_status = "PASSED"
        except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
            result.objective_status = "FAILED"
            result.objective_notes = [str(exc)]
    inputs = [
        ("Packet", f"`{packet_path.name}`"),
        ("Running notes", notes_status),
        ("Roll20 manifest", roll20_status),
    ]
    build_notes = asset_notes
    if proof_sections:
        build_notes = ["Representative proof sections: " + ", ".join(proof_sections)] + build_notes
    write_manifest(result, source_dir, out_dir, inputs, config_note, entries, build_notes)
    todo_path = out_dir / "pdf_render_todo.md"
    if not rendered:
        write_render_todo(todo_path, html_path.name, warning)
    elif todo_path.exists():
        todo_path.unlink()
    if mode == "final" and result.objective_status != "PASSED":
        raise SystemExit(f"Final build failed objective validation. See {manifest_path}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a proof or final adventure HTML/CSS/PDF packet from an adventure folder."
    )
    parser.add_argument("adventure_dir", type=Path, help="Adventure folder, e.g. one-shots/<slug>/")
    parser.add_argument("--packet", default="one_shot_packet.md", help="Module manuscript filename (required file).")
    parser.add_argument(
        "--notes",
        nargs="?",
        const="one_shot_dm_running_notes.md",
        default=None,
        help=(
            "Append a legacy DM running-notes file. It is never auto-detected; pass this flag "
            "only for an explicitly requested legacy export."
        ),
    )
    parser.add_argument(
        "--roll20",
        nargs="?",
        const="roll20_setup_manifest.md",
        default=None,
        help=(
            "Include the Roll20 setup manifest as an appendix. The manifest is a standalone "
            "working file and is NEVER auto-included; it is appended only when this flag is "
            "passed (optionally with a filename; default roll20_setup_manifest.md)."
        ),
    )
    parser.add_argument("--config", default=None, help="Adventure metadata JSON filename (default adventure.json).")
    parser.add_argument("--out", default="pdf", help="Output subfolder inside the adventure folder (default: pdf).")
    parser.add_argument(
        "--mode",
        choices=("proof", "final"),
        default="proof",
        help="Build an internal proof (default) or a strictly validated final candidate.",
    )
    parser.add_argument(
        "--proof-section",
        action="append",
        default=[],
        help="In proof mode, include only this H2 section (repeat for a representative layout sample).",
    )
    args = parser.parse_args()

    args.notes_explicit = args.notes is not None
    args.roll20_explicit = args.roll20 is not None
    args.config_explicit = args.config is not None
    args.notes = args.notes or "one_shot_dm_running_notes.md"
    args.roll20 = args.roll20 or "roll20_setup_manifest.md"  # filename only; inclusion gated by roll20_explicit
    args.config = args.config or "adventure.json"

    result = build(args)
    print(f"HTML: {result.html_path}")
    print(f"CSS: {result.css_path}")
    print(f"Manifest: {result.manifest_path}")
    print(f"Mode: {result.mode}")
    if result.rendered_pdf:
        print(f"PDF: {result.pdf_path}")
    else:
        print(f"PDF not rendered: {result.warning}")


if __name__ == "__main__":
    main()
