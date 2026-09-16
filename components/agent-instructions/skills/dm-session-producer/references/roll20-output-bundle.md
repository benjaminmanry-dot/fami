# Roll20 Session Bundle

Use this for an ongoing campaign's Roll20 setup. The goal is a small, explicit table-ready bundle, not a second adventure manuscript or PDF package.

By default, produce a manual setup manifest. When Ben explicitly asks for importer automation, also use `roll20-importer-workflow.md`, `roll20_import_manifest.json`, and the retained importer builder. Never store Roll20 credentials, cookies, or API keys.

## Outputs

- `roll20_setup_manifest.md`: source of truth for pages, tokens, handouts, and readiness.
- `roll20/README.md`: brief manual setup instructions when a separate bundle is useful.
- `roll20_import_manifest.json` and `roll20/dm-session-importer.js`: only for an explicitly requested importer run.

Reference campaign asset files by stable filename rather than duplicating them unless Ben asks for an export copy.

## Manifest Content

For each page, record its exact title, map or theater-of-the-mind fallback, grid/scale, lighting/fog, hidden GM objects, starting token positions, and minimum fallback.

For each token, record its exact visible name, image, role, page/layer, size, bars/markers, permissions, quick-stat source, and missing-art fallback.

For each handout, record its exact title, source text/image, reveal timing, folder, permissions, GM notes, and fallback.

Use a small folder structure and include only things the DM expects to use. Order work as required setup, likely branches, optional polish, then final readiness check.

## Importer Readiness

- Use stable filenames and asset keys.
- Keep player-facing text separate from GM-only notes.
- State dimensions in grid squares and make status explicit.
- Put optional or conditional tokens on the GM layer.
- Treat upload and script execution as human-controlled steps.
