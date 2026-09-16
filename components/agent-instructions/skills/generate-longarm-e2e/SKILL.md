---
name: generate-longarm-e2e
description: Generate professional continuous-line computerized longarm quilting designs, edge-to-edge pantographs, coordinated quilt design sets, nested repeat previews, and editable DXF handoff files. Use when Codex needs to design, draft, refine, export, or quality-check longarm E2E patterns, coordinate designs for borders/blocks/triangles/sashing, continuous stitch paths, nested rows, repeatable quilting DXF files, or motif-based longarm designs.
---

# Generate Longarm E2E

## Overview

Create original, smooth, continuous-line computerized longarm quilting designs that stitch as one uninterrupted ordered path. Edge-to-edge pantographs are the main workflow, but the same standards apply to coordinated quilt design sets, borders, blocks, triangles, sashing, and standalone square/object layouts: machine-reliable start/end behavior, graceful spacing, no jumps, no retraced connector paths, and a preview that proves the stitch path works.

Never copy or closely imitate a protected the textile designer design. Use her public teaching material only as a quality model: intentional motif development, accurate alignment, continuous-line construction, and quilting that supports the quilt top rather than competing with it.

## Workflow

1. Infer or ask for the motif family, quilt geographies, row width, row depth, density, and whether this is an E2E repeat, a coordinate design set, or a standalone continuous-line layout. The production handoff format is DXF unless the user explicitly asks otherwise. If unspecified, default to a 12 inch repeat width, 5 to 7 inch row depth, 0.04 inch stitch spacing, and 50% alternate-row offset.
2. Read `references/style-and-quality.md` before drafting any customer-facing or themed pattern. For professional, heirloom, the textile designer-quality, coordinate, border, block, triangle, sashing, focal, or custom-quilting requests, also read `references/artistic-engine.md`, `references/professional-art-standard.md`, `references/composition-templates.md`, `references/susan-manry-informed-motif-library.md`, and `references/coordinate-designs.md`. For completion audits, user-approved exemplars, or golden quality checks, also read `references/golden-acceptance-suite.md`. Built-in presets are smoke tests, not a professional art standard.
3. Design one continuous stitch path from the left repeat edge to the right repeat edge. For E2E repeats, the start and end points must sit on the same horizontal plane within 0.001 inch; normally use `(0, 0)` and `(repeat_width, 0)`. If the end point is even slightly higher or lower than the start point, horizontal repeats will step instead of chaining cleanly on a computerized longarm. Also keep the start and end tangents compatible; a repeat can be position-correct and still show a visible hitch if the needle exits at a sharply different heading than it enters.
4. Build the design from broad motifs first, then add echo lines, pearls, leaves, feathers, curls, or geometry only when they improve rhythm and fill. Never accept novelty-object outlines as-is; translate them into quilting motifs.
5. Generate both a single-row view and a nested multi-row repeat. Reject designs with visible row stripes, crowded collisions, accidental gaps, disconnected subpaths, jump moves, tie-off-dependent travel, jagged point noise, awkward travel lines, crude novelty outlines, or any connector that stitches out and later stitches back along the same path.
6. Export the editable production handoff as DXF R12. Do not generate SVG, PLT, TXT, `.hqv`, or other publishing formats unless the user explicitly asks for them. The user will edit and publish final formats from the DXF.
7. State that the result must be machine-tested before customer release.

## Coordinate Design Sets

Use coordinate design sets when a quilt needs related but non-identical designs across different geographies such as borders, blocks, triangles, sashing, corners, alternate blocks, and a focal block.

For coordinate sets:

- Make a motif library before drawing. Example: star, heart, sunflower, tricycle.
- For professional coordinate work, prefer the source-informed motif grammar in `references/susan-manry-informed-motif-library.md`: layered borders, pearl chains, focal flowers or rosettes, flower echoes, floral pearl centers, flourish scrolls, echoed hearts, leaf chains, feather triangles, clamshell fills, wavy piano keys, framed mats, and concentric ditch-to-edge lines.
- For professional coordinate work, also use curated motif assets in `assets/artistic-library/motifs.json` and master composition templates in `assets/artistic-library/templates.json`. Do not rely on freshly invented procedural primitives when a curated motif/template exists.
- Generate 3 to 6 art-direction thumbnails with `scripts/generate_art_thumbnails.py` before DXF. Score them with `scripts/score_art_thumbnails.py`. Do not digitize a thumbnail that scores below 85 or has hard failures.
- Create an art-board plan before drawing DXF. Use `scripts/plan_coordinate_artwork.py` for heirloom, custom, professional, or the textile designer-quality requests.
- Put the full motif library in the focal design.
- Put only selected motifs in supporting designs; never put every motif everywhere unless the user explicitly asks.
- Keep density similar across geographies by matching line spacing, echo count, negative-space rhythm, and motif scale.
- Vary each geography with different motif subsets, scale, rotation, connector rhythm, or accent fill.
- Draw each geography as its own continuous-line DXF.

Use `scripts/plan_coordinate_artwork.py` to make a professional art-board plan before drawing.

Use `scripts/generate_art_thumbnails.py` before or alongside the art-board plan when art quality is the primary concern.

Example:

```bash
python scripts/generate_art_thumbnails.py --name "Heirloom Sakura Coordinate" --theme "sakura, pearl, scroll, heart, and feather coordinate set" --geographies "focal,border,corner,block,triangle,sashing" --density dense --count 4 --out ./sakura-thumbnails
python scripts/score_art_thumbnails.py ./sakura-thumbnails/thumbnail-options.json --out ./sakura-thumbnails/art-thumbnail-scores.json
```

Choose the highest-scoring thumbnail that has no hard failures, then proceed to the coordinate art-board plan and DXF digitizing.

Passing thumbnail scores are a minimum gate, not proof of beauty. If the best thumbnail still looks procedural, revise or create new thumbnails before DXF.

For reference-grade heirloom coordinate work, use `scripts/build_heirloom_coordinate.py` to create a full art-board benchmark preview and DXF layer file, then run `scripts/audit_artboard_quality.py` on the generated art-board DXF. This benchmark is still not a substitute for human approval, but it is a stronger starting point than the generic thumbnail renderer. Do not present the benchmark as production-worthy if the preview still reads as procedural primitives, tangled motif knots, floating icons, or unplanned filler. When that happens, report it as a research draft and stop before pretending the DXF meets the requested art standard.

Example:

```bash
python scripts/build_heirloom_coordinate.py --name "Heirloom Coordinate Art Board" --out ./heirloom-coordinate
python scripts/audit_artboard_quality.py ./heirloom-coordinate/heirloom-coordinate-art-board.dxf --out ./heirloom-coordinate/artboard-audit.json
python scripts/critique_artboard_style.py ./heirloom-coordinate/heirloom-coordinate-art-board.dxf --audit ./heirloom-coordinate/artboard-audit.json --out ./heirloom-coordinate/style-critique.json
python scripts/machine_behavior_qa.py ./heirloom-coordinate/heirloom-coordinate-art-board.dxf --out ./heirloom-coordinate/machine-qa.json
python scripts/route_continuous_paths.py ./heirloom-coordinate/heirloom-coordinate-art-board.dxf --out ./heirloom-coordinate/continuous-route-manifest.json --routed-dxf ./heirloom-coordinate/continuous-route-check.dxf
python scripts/compile_continuous_path.py ./heirloom-coordinate/heirloom-coordinate-art-board.dxf --layers top-border --x-min 4.5 --x-max 8.9 --route nearest --connector echo-travel --force-connector --out ./heirloom-coordinate/top-border-unit-continuous.dxf --manifest ./heirloom-coordinate/top-border-unit-continuous-manifest.json --preview-png ./heirloom-coordinate/top-border-unit-continuous.png
python scripts/machine_behavior_qa.py ./heirloom-coordinate/top-border-unit-continuous.dxf --strict-continuous --out ./heirloom-coordinate/top-border-unit-continuous-machine-qa.json
```

If a previous approved or stronger candidate exists, compare before delivery:

```bash
python scripts/compare_artboard_regression.py --candidate ./heirloom-coordinate --baseline ./previous-approved-coordinate --out ./heirloom-coordinate/regression-comparison.json
```

Use the route manifest as a routing diagnostic. If it shows long exposed travel, redesign those moves as vines, frames, pearls, echoes, or intentional connectors before treating the design as a continuous-line quilting candidate.

Use `scripts/compile_continuous_path.py` only after the route diagnostic, and normally at the component or geography level: a border unit, a block, a triangle, a sashing strip, or a focal component. Use `--x-min`, `--x-max`, `--y-min`, and `--y-max` to isolate a true production repeat or component before compiling. The compiler creates a one-polyline stitch candidate and uses `assets/artistic-library/anchor-grammar.json` to choose connector styles such as soft S-curves, smooth vines, pearl chains, echo travel, and quiet rails. Use `--force-connector` when the grammar-selected connector is too decorative for the component. If the manifest reports review connectors, treat those as design problems to inspect, not as automatically solved travel.

When a compiled border unit still shows shortcut-looking travel, redraw the component natively with `scripts/build_native_border_repeat.py` instead of continuing to tune connector routing. Native component builders draft the motif around one continuous stitch route from the beginning.

Example:

```bash
python scripts/build_native_border_repeat.py --name "Native Sakura Heart Border Repeat" --out ./native-border-repeat --width 6 --stitch-spacing 0.025
python scripts/machine_behavior_qa.py ./native-border-repeat/native-sakura-heart-border-repeat.dxf --strict-continuous --out ./native-border-repeat/machine-qa.json
```

Inspect both the single-repeat preview and the chained preview before treating the DXF as useful. The native builder is a stronger stitch-path exemplar than a compiled component, but it is still subject to human art approval.

A straight border repeat is incomplete until there is a matching native corner turn. Use `scripts/build_native_corner_turn.py` to create a corner component and a border-corner-side chain test.

Example:

```bash
python scripts/build_native_corner_turn.py --name "Native Sakura Heart Corner Turn" --out ./native-corner-turn --size 6 --stitch-spacing 0.025 --top-repeats 2 --side-repeats 2
python scripts/machine_behavior_qa.py ./native-corner-turn/native-sakura-heart-corner-turn.dxf --strict-continuous --out ./native-corner-turn/corner-machine-qa.json
python scripts/machine_behavior_qa.py ./native-corner-turn/native-border-corner-chain.dxf --strict-continuous --out ./native-corner-turn/chain-machine-qa.json
```

Inspect the corner alone and the chain preview. Reject the corner if it reads as a diagonal connector, cropped straight border, pasted-on motif, or mismatch with the straight repeat.

Setting triangles and corner triangles need native triangle logic, not cropped blocks. Use `scripts/build_native_setting_triangle.py` when a coordinate set needs a broad-edge-to-broad-edge triangle component with diagonal flow, inward feather/leaf plumes, a softened point, and a mirrored companion.

Example:

```bash
python scripts/build_native_setting_triangle.py --name "Native Sakura Feather Setting Triangle" --out ./native-setting-triangle --width 6 --depth 5 --stitch-spacing 0.025
python scripts/machine_behavior_qa.py ./native-setting-triangle/native-sakura-feather-setting-triangle.dxf --strict-continuous --out ./native-setting-triangle/triangle-machine-qa.json
python scripts/machine_behavior_qa.py ./native-setting-triangle/native-sakura-feather-setting-triangle-mirrored.dxf --strict-continuous --out ./native-setting-triangle/triangle-mirrored-machine-qa.json
```

Inspect both normal and mirrored previews. Reject the triangle if it reads as a cropped block, a bare V-shaped travel line, floating motifs inside a triangle, or a literal blossom squeezed into too little space.

Sashing and narrow rails should coordinate quietly. Use `scripts/build_native_sashing_rail.py` when a coordinate set needs a chainable strip with a centerline vine, small leaves, restrained curls, optional vertical companion, and a chained repeat test.

Example:

```bash
python scripts/build_native_sashing_rail.py --name "Native Sakura Leaf Sashing Rail" --out ./native-sashing-rail --width 8 --height 1.5 --stitch-spacing 0.025 --repeats 5
python scripts/machine_behavior_qa.py ./native-sashing-rail/native-sakura-leaf-sashing-rail.dxf --strict-continuous --out ./native-sashing-rail/sashing-machine-qa.json
python scripts/machine_behavior_qa.py ./native-sashing-rail/native-sakura-leaf-sashing-rail-chained.dxf --strict-continuous --out ./native-sashing-rail/sashing-chain-machine-qa.json
python scripts/machine_behavior_qa.py ./native-sashing-rail/native-sakura-leaf-sashing-rail-vertical.dxf --strict-continuous --out ./native-sashing-rail/sashing-vertical-machine-qa.json
```

Inspect the single repeat, the chained preview, and the vertical preview. Reject the sashing if it competes with the border, becomes a dense rope, has visible repeat hiccups, or uses naked travel instead of a quiet rail/vine.

Blocks and alternate blocks need a contained internal composition, not a border motif enlarged into a square. Use `scripts/build_native_block_component.py` when a coordinate set needs a square block with a soft frame or diamond skeleton, focal rosette, support leaves/scrolls, optional echoed heart, mirrored companion, and row-chain test.

Example:

```bash
python scripts/build_native_block_component.py --name "Native Sakura Diamond Block" --out ./native-block-component --size 6 --stitch-spacing 0.025 --row-repeats 3
python scripts/machine_behavior_qa.py ./native-block-component/native-sakura-diamond-block.dxf --strict-continuous --out ./native-block-component/block-machine-qa.json
python scripts/machine_behavior_qa.py ./native-block-component/native-sakura-diamond-block-mirrored.dxf --strict-continuous --out ./native-block-component/block-mirrored-machine-qa.json
python scripts/machine_behavior_qa.py ./native-block-component/native-sakura-diamond-block-row.dxf --strict-continuous --out ./native-block-component/block-row-machine-qa.json
```

Inspect the block, mirror, and row preview. Reject the block if it reads as a loose vine passing through a square, a cropped border repeat, a motif pile with no containment, or a design that cannot route out without naked travel.

Focal medallions should carry the richest motif statement in a coordinate set. Use `scripts/build_native_focal_medallion.py` when a coordinate set needs a central medallion with the full motif vocabulary: focal rosette, halo, hearts, leaves, scrolls, top flame/echo, a closed lower-point route, and a mirrored companion.

Example:

```bash
python scripts/build_native_focal_medallion.py --name "Native Sakura Focal Medallion" --out ./native-focal-medallion --size 8 --stitch-spacing 0.025
python scripts/machine_behavior_qa.py ./native-focal-medallion/native-sakura-focal-medallion.dxf --strict-continuous --out ./native-focal-medallion/focal-machine-qa.json
python scripts/machine_behavior_qa.py ./native-focal-medallion/native-sakura-focal-medallion-mirrored.dxf --strict-continuous --out ./native-focal-medallion/focal-mirrored-machine-qa.json
```

Inspect both the medallion and mirror. Reject the focal if it reads like an enlarged supporting block, has a weak center, knots up at the lower closure, leaves large accidental empty regions, or lacks a clear center/support hierarchy.

After individual native components look acceptable, use `scripts/build_native_coordinate_set.py` to produce the complete coordinate package in one pass. This script builds the focal, border, corner, setting triangle, sashing, and block components; runs strict machine QA on every production and stress-test DXF; applies repeat seam tangent checks to chainable border, sashing, and row outputs; creates start/end/direction stitch-flow overlays; creates a role-aware contact-sheet preview with border and sashing shown as full-width bands; records motif distribution and role-aware density review; runs a native package art critique; creates `native-package-review-report.html`; and bundles the editable DXFs.

Example:

```bash
python scripts/build_native_coordinate_set.py --name "Native Sakura Coordinate Set" --out ./native-coordinate-set --stitch-spacing 0.025
python scripts/build_native_coordinate_set.py --name "Native Sakura Coordinate Set" --out ./native-coordinate-set-next --stitch-spacing 0.025 --baseline-package ./native-coordinate-set
```

Inspect `native-package-review-report.html` first, then the contact sheet, manifest, QA files, and `native-package-art-critique.json` before delivery. The contact sheet should read as a role-aware review board: focal/block/triangle/corner in larger panels, border and sashing in strip bands. The review report includes a Preview Framing table for ink presence, coverage, center offset, and margins; a Machine Warning Scope section that separates primary production DXF warnings from mirrored, chained, row, and orientation stress-test repeats; a Seam / Repeat Joins table for endpoint plane and tangent compatibility on chainable outputs; a Stitch Flow table with start/end/direction overlay maps for every QA target; and a Machine Hotspots table with visual overlay maps and sampled DXF coordinates for reversals, cusps, and tiny segments. Use those maps and coordinates to inspect or revise motifs before making broad geometry changes. Treat a package as incomplete if any component build fails, strict machine QA fails, repeat seam tangent checks flag a chainable production output, stitch-flow overlays are missing, the role-aware density review reports flags, the art critique fails, the review report cannot be generated, the preview framing is visibly off-center, or the contact sheet shows a weak focal/support hierarchy. A passing native coordinate package proves the Skill can produce a coherent continuous-line DXF family; it still needs human art approval and machine testing before publication.

Run or inspect the native package critique directly when the art still feels mathematical, sparse, over-regular, or underdeveloped:

```bash
python scripts/critique_native_coordinate_package.py ./native-coordinate-set --out ./native-coordinate-set/native-package-art-critique.json
```

Warnings from this script are not automatic failures. Use them to focus the human visual pass on line-character warmth, focal development, motif distribution, preview framing, and machine-risk details such as petal tips, heart clefts, and tight scrolls. When machine warnings remain, check whether they belong to the primary production DXFs or companion stress tests, then inspect the QA hotspot coordinates in the report and JSON before deciding whether to smooth a point, preserve an intentional motif tip, or mark it for machine test. For native component builders, use tiny rounded caps, rosette hub routing, and `longarm_geometry.soften_hard_turns()` before export when a decorative point creates a hard needle reversal. The native package critique evaluates line character at design scale while preserving machine-scale metrics separately; do not add artificial wobble merely to satisfy stitch-point statistics.

When critique warnings name a specific native component, revise that component generator directly, regenerate the full package, and compare against the strongest prior package. Keep the candidate only if strict QA still passes, the art critique still passes, and `scripts/compare_native_coordinate_package.py` reports no regressions plus a meaningful visual or drawn-line improvement.

If a previous approved or strongest native coordinate package exists, compare the new package before delivery:

```bash
python scripts/compare_native_coordinate_package.py --candidate ./native-coordinate-set --baseline ./previous-native-coordinate-set --out ./native-coordinate-set/native-package-regression-comparison.json
```

Prefer passing the baseline with `--baseline-package` to `scripts/build_native_coordinate_set.py` so the regression comparison is recorded in the package manifest and DXF bundle automatically. Reject or revise the candidate if the comparison reports regressions in component coverage, strict QA, seam-join coverage, stitch-flow overlay coverage, art-critique score or warnings, motif vocabulary, role-aware density, line character, drawn-line development, or preview line presence. A tie is acceptable when the generator is deterministic and the intent is to prove repeatability.

For a completion or golden-candidate audit, run `scripts/check_golden_acceptance.py` after the native package build and regression comparison:

```bash
python scripts/check_golden_acceptance.py ./native-coordinate-set --out ./native-coordinate-set/golden-acceptance-check.json
```

This check uses the benchmark rubric in `references/golden-acceptance-suite.md`. It validates measurable gates such as component scope, strict QA, seam joins, stitch-flow overlays, art score, motif hierarchy, role-aware density, handoff artifacts, and regression cleanliness. Passing it means the package is ready for human art comparison and machine testing; it does not mean the referenced award-winning designs may be copied or that the generated work is automatically publishable.

Example:

```bash
python scripts/plan_coordinate_artwork.py --name "Heirloom Heartflower Coordinate Plan" --theme "romantic floral coordinate set" --sections "focal medallion:1:focal,outer border:4:border,corner blocks:4:corner,alternate blocks:8:block,setting triangles:8:triangle,sashing:12:sashing" --focal "focal medallion" --density dense --out ./heartflower-art-plan
```

Use `scripts/plan_coordinate_designs.py` only for quick motif distribution when the user does not need professional art-board planning.

Example:

```bash
python scripts/plan_coordinate_designs.py --name "Playroom Coordinate Set" --elements "star,heart,sunflower,tricycle" --sections "focal:1,outer border:4:border,blocks:12:block,setting triangles:8:triangles,sashing:16:sashing" --focal focal --density medium
```

The planners are design-planning aids, not publishing formats. For professional coordinate designs, do not deliver DXF until the art-board plan or preview passes the quality gate in `references/professional-art-standard.md`. Deliver DXFs for the actual quilting designs; summarize the motif distribution and art-board decisions in the response.

After creating a professional art-board plan, run `scripts/check_coordinate_art_plan.py` on the generated `coordinate-artwork-plan.json`. Revise the plan before DXF if it fails focal/support motif logic, density spread, missing skeletons, triangle suitability, or floating-motif rejection checks.

If `score_art_thumbnails.py` and `check_coordinate_art_plan.py` disagree, obey the stricter result. A structurally valid plan can still be artistically weak.

## Curated Motif Assets

Professional coordinate work improves when the Skill can reuse original, approved vector motifs instead of inventing every curve procedurally.

Use `scripts/ingest_motif_asset.py` only for motifs that are original Codex-created assets, user-owned assets, or assets the user has explicit permission to reuse. Never ingest commercial quilting designs from SusanManry.com or any public reference site as reusable assets. Public references may inform quality expectations, motif grammar, density, and tone, but the stored vectors must be original or permitted.

Example:

```bash
python scripts/ingest_motif_asset.py ./approved-sakura-sprig.svg --id sakura-sprig-approved-01 --name "Approved Sakura Sprig" --permission-note "Original Codex-generated motif approved by the user in this project." --roles "support,connector,block" --geographies "focal,block,border,corner" --anchors "vine,frame,tangent" --variants "single sprig,echoed sprig,corner sprig" --entry-exit "Enter through the vine tangent and exit through the echo frame." --misuse "Do not place as a floating flower icon."
```

Curated motif records should include role, geography, anchor, density, hierarchy, entry/exit behavior, variants, misuse notes, style notes, and machine notes. Promote a candidate motif to approved only after visual review and at least one successful DXF use.

Use `assets/artistic-library/anchor-grammar.json` to decide how motifs attach to frames, spines, pearl tangents, corner turns, rails, and triangle diagonals. Motifs without usable anchors should remain research assets until they can route in and out as continuous quilting.

## Pattern Builder

Use `scripts/build_e2e_pattern.py` to create editable DXF continuous-line patterns for computerized longarm stitching. It can generate built-in motif families or consume a custom waypoint JSON spec. Treat built-in presets as geometry tests; professional output should normally use a custom spec.

Example:

```bash
python scripts/build_e2e_pattern.py --preset botanical-vine --name "Willow Garden E2E" --out ./willow-garden --width 12 --row-height 6 --row-advance 3.4 --offset 6
```

By default, the script writes only:

- `<name>.dxf`

Use `--qa-artifacts` only when you need diagnostic previews and notes. That optional mode also writes single-row and nested SVG previews, source SVG, PLT, TXT, and `README.md`. The README reports the actual start point, end point, and start/end horizontal-plane delta. In strict E2E mode, any start/end y mismatch above 0.001 inch is a review failure because the repeat will not chain cleanly.

Use `--list-presets` to see available scaffold families.

For `.hqv` or other publishing formats, do not synthesize files. Deliver the DXF and let the user's editing/publishing workflow create the final formats.

## Square Object Layouts

Use `scripts/build_square_layout.py` when the request is to place objects within a square and create one continuous computerized-longarm path between them without backtracking.

Example:

```bash
python scripts/build_square_layout.py --name "Sakura Square Path" --out ./sakura-square --size 10 --objects 9 --motif sakura --stitch-spacing 0.025
```

The square layout generator:

- Places objects on an inset square/grid.
- Routes them in a serpentine Hamiltonian path, visiting each object once.
- Stitches each motif as a loop and moves to the next object without retracing connector travel.
- Runs the same backtracking detector used for E2E QA.

If the user asks for a square layout, deliver the DXF as a continuous-line computerized-longarm layout; do not present it as a nested E2E row unless it has also been explicitly repeated and inspected. Use `--qa-artifacts` if a source spec or rendered path preview is needed for review.

## Custom Motifs

For a bespoke design, create a JSON spec and pass it with `--spec`. Use actual inch coordinates. For E2E repeats, the first waypoint must be on the left repeat edge, the final waypoint must be on the right repeat edge, and both must share the same y coordinate within 0.001 inch. Keep `x` moving generally forward, with intentional loops returning only as needed for leaves, feathers, pearls, curls, or echo work.

```json
{
  "name": "Example Garden Scroll",
  "repeat_width": 12.0,
  "row_height": 6.0,
  "row_advance": 3.4,
  "alternate_offset": 6.0,
  "stitch_spacing": 0.04,
  "waypoints": [
    [0.0, 0.0],
    [0.8, 0.1],
    [1.5, 1.4],
    [2.3, 0.3],
    [1.6, -0.2],
    [3.0, 0.0],
    [12.0, 0.0]
  ]
}
```

After running the script, inspect the previews visually and edit the waypoints until the design feels nested, balanced, and stitchable.

## Quality Gate

Before delivering a pattern, confirm:

- One continuous stitch path, no unplanned jumps.
- Start and end points share the same horizontal plane within 0.001 inch, and the right-edge end point chains cleanly into the next repeat's left-edge start point.
- Nested rows look intentional at multiple repeats, not like separate stripes.
- Pathing between motifs does not backtrack or retrace connector segments.
- Curves are smooth enough for longarm motion; no pixelated, shaky, or over-pointed outlines.
- Motif density is balanced; negative space supports the quilt top.
- The art has a clear motif grammar and would pass as a sellable pantograph, not merely as a technically valid path.
- The pattern remains original and does not reproduce a named commercial design.
- Coordinate sets have similar density from geography to geography while still varying motif mix, scale, and connector rhythm.
- Coordinate focal designs contain the full motif library, while supporting designs contain some but not all motifs.
- Professional coordinate designs have an art-board plan before DXF, with a boundary-aware skeleton for every geography.
- Professional coordinate designs use a master composition template and curated motif assets unless the user explicitly requests experimental freehand drafting.
- Professional coordinate designs include multiple scored art-direction thumbnails before stitch routing.
- Professional coordinate art-board plans pass `scripts/check_coordinate_art_plan.py` before stitch digitizing begins.
- Reference-grade heirloom coordinate previews pass `scripts/audit_artboard_quality.py` before DXF is treated as production-worthy.
- Reference-grade coordinate previews also pass `scripts/critique_artboard_style.py` and `scripts/machine_behavior_qa.py` before being treated as a delivery candidate.
- Continuous-line candidate DXFs include a `scripts/route_continuous_paths.py` manifest; long exposed travel moves must be converted into designed connectors or called out as unresolved.
- Component-level coordinate DXFs use `scripts/compile_continuous_path.py` when separated motifs need to become one explicit stitch path, followed by `scripts/machine_behavior_qa.py --strict-continuous` on the compiled DXF and visual review of the compiled preview.
- A compiled path that is mechanically continuous but visually connected by shortcut-looking diagonals, awkward loops, or exposed travel is still a failed production candidate; redraw the source motif anchors or connector spine instead of accepting it.
- When connector compilation repeatedly exposes travel, prefer a native continuous component generator such as `scripts/build_native_border_repeat.py`; the motif should be drafted around the stitch route rather than assembled and repaired.
- Native border components need a tested corner companion from `scripts/build_native_corner_turn.py`; straight repeats alone are not a finished coordinate border.
- Native setting triangles use `scripts/build_native_setting_triangle.py`; they must enter and exit on the broad-edge baseline, taper into the point, include a mirrored companion, and pass strict machine QA on both orientations.
- Native sashing rails use `scripts/build_native_sashing_rail.py`; they must chain cleanly as a quiet strip, include a chained DXF/preview, and pass strict machine QA on the single, chained, and vertical companion outputs.
- Native block components use `scripts/build_native_block_component.py`; they must have a block-specific skeleton, focal/support hierarchy, mirrored companion, row-chain test, and strict machine QA on the block, mirror, and row outputs.
- Native focal medallions use `scripts/build_native_focal_medallion.py`; they must contain the richest motif vocabulary, have an obvious focal center, include a mirrored companion, and pass strict machine QA on both outputs.
- Full native coordinate packages use `scripts/build_native_coordinate_set.py`; they must include a contact sheet, manifest, HTML review report, DXF bundle, role-aware density review, native package art critique, and strict machine QA on every listed DXF.
- Native coordinate contact sheets should use role-aware paneling; border and sashing previews should read as strip bands rather than tiny lines floating in square panels.
- Native package art critiques from `scripts/critique_native_coordinate_package.py` must pass before delivery; warnings should be summarized honestly, separated into production-design warnings and companion/stress-test repeats, and used to focus human review.
- Native coordinate previews must be readable and centered in the report; the Preview Framing table should not show large unexplained center offsets or lopsided margins for the relevant geography.
- Critique-driven native revisions must be followed by a full package rebuild and native package regression comparison; do not accept added density that creates QA failures, component imbalance, or a weaker contact-sheet read.
- When a baseline package exists, run `scripts/build_native_coordinate_set.py` with `--baseline-package` or run `scripts/compare_native_coordinate_package.py` separately; the candidate must not regress in art critique, machine QA, line character, component coverage, or preview line presence.
- For golden-candidate or final-completion review, read `references/golden-acceptance-suite.md` and run `scripts/check_golden_acceptance.py`; a package that fails the measurable golden gates is not ready to freeze.
- Do not present a whole art-board compilation as production-ready unless the quilt is intentionally stitched as one file and the connector manifest has no unresolved design-travel concerns.
- Art-board regression candidates are compared with `scripts/compare_artboard_regression.py`; native coordinate packages are compared with `scripts/compare_native_coordinate_package.py` against the best available approved or strongest prior run, whenever such a baseline exists.
- Passing scripts do not override visual judgment; revise any art that still looks procedural, sparse, tangled, or unprofessional.
- Motifs are integrated into frames, spines, borders, corners, echoes, pearls, or area boundaries; they do not float as icons connected by exposed travel.
- Professional coordinate previews include a line-character pass: avoid visibly trigonometric vines, perfectly stamped motif repetition, formula hearts, identical scrolls, and over-regular spacing unless the quilt intentionally calls for ruler-like geometry.
- If no user-approved exemplar or hand-curated vector motif library is available for the requested professional style, disclose that limitation. Procedural motif primitives can prove layout, density, nesting, and DXF export, but they cannot by themselves guarantee publishable heirloom art.
- Final handoff includes the editable DXF, key measurements in the response, recommended row advance and alternate-row offset for E2E patterns, and a machine-test note.
