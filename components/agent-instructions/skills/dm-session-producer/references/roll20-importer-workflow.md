# Roll20 Importer Workflow

Use this when the user asks to automate Roll20 setup from a DM Session Producer packet.

## Practical Constraint

Roll20 Mod/API scripts can create and configure pages, graphics, tokens, characters, handouts, and macros, but they cannot upload arbitrary local files into a user's Roll20 Art Library. Graphics created by a Mod script need an `imgsrc` that already exists in the Roll20 library.

Therefore, the reliable no-key workflow is:

1. The skill generates a Roll20 import bundle.
2. The user uploads maps and tokens into Roll20 or drags them onto a staging page.
3. The Roll20 Mod script captures the uploaded image URLs from selected/staged graphics.
4. The Mod script builds pages, maps, tokens, characters, handouts, and setup objects from the manifest.

This is not OpenAI API work. It does not require an OpenAI API key. It does not require Roll20 credentials in Codex.

## Output Files

For each packet that should support Roll20 import, produce:

- `roll20_import_manifest.json`: structured import plan.
- `roll20/dm-session-importer.js`: Roll20 Mod script with the manifest embedded.
- `roll20/UPLOAD_AND_IMPORT.md`: plain-language instructions for the DM.
- `roll20/pages/`: upload-ready maps.
- `roll20/tokens/`: upload-ready transparent tokens.
- Optional `roll20/handouts/`: upload-ready handout images.

## Manifest Shape

The manifest should include:

- `id`: stable packet id.
- `title`: adventure/session title.
- `session`: session number or packet label.
- `assets`: ordered lists of maps, tokens, and optional handouts.
- `pages`: exact Roll20 page definitions, including width/height in grid squares, map asset, grid, scene use, and optional token placements.
- `characters`: NPC/monster character shells with token asset, GM notes, bars, and default token sizing.
- `handouts`: text/image handouts with reveal timing and GM notes.
- `macros`: optional GM-facing macros or tracker notes.

Keep filenames exact. Do not rely on vague names like "the vampire token."

## Roll20 Mod Commands

The generated importer should support:

- `!dm-import help`: show workflow.
- `!dm-import status`: show which assets are bound.
- `!dm-import scan`: match staged graphics by name when the graphic name contains the filename.
- `!dm-import bind <asset-key>`: bind one selected Roll20 graphic to a specific manifest asset.
- `!dm-import bind-selection maps`: bind selected graphics to map assets in top-to-bottom, left-to-right order.
- `!dm-import bind-selection tokens`: bind selected graphics to token assets in top-to-bottom, left-to-right order.
- `!dm-import bind-selection all`: bind selected graphics to all missing assets in manifest order.
- `!dm-import build`: create pages, place maps/tokens, and create characters/handouts.
- `!dm-import build --allow-missing`: build what is available and report missing assets.
- `!dm-import reset`: clear saved bindings for this manifest.

## Staging Page Convention

Tell the DM to create a Roll20 page named:

`00 DM Import Staging`

Then drag maps and tokens onto the page. The easiest binding method is:

1. Put maps in manifest order in one row.
2. Select all maps.
3. Run `!dm-import bind-selection maps`.
4. Put tokens in manifest order in one row.
5. Select all tokens.
6. Run `!dm-import bind-selection tokens`.
7. Run `!dm-import status`.
8. Run `!dm-import build`.

## Browser Uploader Phase

A later local companion wrapper may use the user's logged-in browser session to automate the upload step, but treat that as a separate browser-automation layer. The skill's first reliable automation target is the Roll20 Mod importer.
