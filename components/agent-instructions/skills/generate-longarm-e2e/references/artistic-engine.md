# Artistic Engine

Use this reference when the user is unhappy with art quality, asks for publishable/professional work, or asks for a coordinate design in the quality range of the uploaded heirloom example.

The core rule: do not generate professional quilting artwork directly from procedural primitives. Use curated motifs, master composition templates, thumbnail options, and critique before DXF.

## Required Sequence

1. Read `professional-art-standard.md`, `susan-manry-informed-motif-library.md`, and this file.
2. Select a master composition template from `composition-templates.md`.
3. Select motifs from `assets/artistic-library/motifs.json`; do not invent all motifs from scratch unless the user explicitly asks for a new motif family.
4. Generate 3 to 6 thumbnail art directions with `scripts/generate_art_thumbnails.py`.
5. Score the thumbnails with `scripts/score_art_thumbnails.py`.
6. Pick the highest-scoring thumbnail or ask the user to choose when the request is exploratory.
7. Convert the chosen art direction into continuous-line DXF only after the score is at least 85 and no hard failures are present.

For reference-grade heirloom coordinate work, run `scripts/build_heirloom_coordinate.py` after thumbnail selection to create a full benchmark art board, then audit it with `scripts/audit_artboard_quality.py`.

After the density audit, run the full competency toolchain:

1. `scripts/critique_artboard_style.py` to check hierarchy, stamped repetition, line-character risk, focal development, and geography balance.
2. `scripts/machine_behavior_qa.py` to check micro-segments, tight reversals, tiny loops, and other machine-motion risks.
3. `scripts/route_continuous_paths.py` to produce a route manifest and reveal long exposed travel that still needs to become designed stitching.
4. `scripts/compile_continuous_path.py` on individual components or geographies when separated motifs need to become one explicit stitch path.
5. `scripts/machine_behavior_qa.py --strict-continuous` on the compiled component DXF.
6. `scripts/compare_artboard_regression.py` against the best available approved or strongest previous run when a baseline exists.

These scripts are gates for deeper review, not automatic publication approval.

## What Counts As Better Art

Professional coordinate quilting artwork has a visible design hierarchy:

- Primary frame or area boundary.
- Secondary focal motif.
- Tertiary echo, pearl, scroll, leaf, or feather support.
- Corner and transition logic.
- Controlled negative space.

Weak procedural art usually fails because motifs float, connectors are exposed, every geography is treated like a generic square, or the design has no hierarchy.

For heirloom coordinate previews, improve motif integration before increasing detail:

- Put border motifs on continuous vine, scroll, pearl, or feather spines.
- Give corner motifs an explicit turn, not just a cluster placed near the corner.
- Put support motifs inside soft frames, curved stems, corner arcs, or medallion axes.
- Remove preview artifacts from component examples when they distract from the whole-quilt read.
- Prefer one confident line that explains why a motif belongs over several small decorative shapes trying to fill the gap.

After motif integration, run a line-character pass:

- Replace analytic hearts, perfect spirals, and exact sine-wave vines with Bezier-drafted curves.
- Vary repeated motif scale, offset, and rotation slightly while preserving the design rhythm.
- Keep pearls and frames precise where precision is part of the quilting language, but soften vines, leaves, hearts, and scrolls.
- If loosening the line creates wandering open curves, tighten those motifs back into framed sprigs or anchored scrolls.
- The goal is professional drafted control, not random wobble.

When adding density after a successful line-character pass:

- Add only the density that solves a named visual problem such as a thin border lane or unsupported frame.
- Do not apply the same secondary accent to every border by symmetry. Top/bottom accents can help while side accents may read as fragments.
- Keep corner zones clear unless the accent is explicitly designed as a corner turn.
- Compare the denser result against the previous version. If added linework creates boxy frames, dark knots, or dangling fragments, remove it.
- Clean failed helper patterns out of the generator so future runs do not accidentally reuse them.

## Thumbnail Requirements

Each thumbnail must specify:

- Template name.
- Focal hierarchy.
- Motif placements with anchor roles such as frame, spine, corner, diagonal, pearl band, medallion axis, or sashing rail.
- Density targets by geography.
- Omitted motifs for support geographies.
- Connector grammar.
- Rejection notes.

For coordinate designs, produce at least three distinct art directions:

- Dense heirloom.
- Balanced custom.
- Airier quilt-supporting version.

Do not digitize the first idea just because it is structurally valid.

## Master Template Discipline

Templates are not optional for professional coordinate designs. A template solves the global composition problem before motif placement begins.

Good templates:

- Establish frames, diamonds, medallions, border lanes, sashing rails, and triangle diagonals.
- Leave intentional breathing room.
- Specify which motifs are focal and which are supporting.
- Include corner-turn logic.

Bad templates:

- Scatter motifs in a box.
- Fill borders with copied block motifs.
- Leave triangles as cropped rectangles.
- Rely on long travel connectors to tie things together.

## Curated Motif Discipline

Use motifs from `assets/artistic-library/motifs.json` as named design assets. These are not final copyrighted patterns; they are original motif definitions with role, anchor, density, and usage metadata.

Use `scripts/ingest_motif_asset.py` to store original or user-permitted vector motifs as curated candidates under `assets/artistic-library/curated-motifs/`. Each ingested motif must carry a permission note, entry/exit behavior, allowed geographies, anchors, density, hierarchy, variants, misuse notes, and machine notes. Do not ingest public commercial quilting artwork as reusable geometry.

Use `assets/artistic-library/anchor-grammar.json` as the attachment contract. Professional motifs need usable anchors: spine tangents, frame tangents, pearl tangents, corner turns, rail baselines, or diagonal tapers. A motif that cannot enter and exit gracefully should not be promoted from candidate to approved.

When adding a new motif:

- Define entry and exit anchors.
- Define allowed geographies.
- Define a polished role: focal, support, connector, frame, fill, corner, or transition.
- Define echo variants and density impact.
- Add a "misuse" note.

Do not add a motif that is merely a clip-art outline.

## Area-Aware Composition

Coordinate designs must treat each quilt geography as a different drawing problem:

- Borders need a spine, turn logic, and repeat rhythm.
- Blocks need containment, focal direction, and a route back out.
- Triangles need tapering motifs and diagonal/broad-edge awareness.
- Sashing needs quieter rails that can chain.
- Corners need a designed turn, not a motif cluster pressed into a corner.

Density should be similar from geography to geography, but the motif mix should differ. The focal can contain the full library. Supporting areas should contain only selected motifs, with scale, rotation, echo count, and connector grammar varied enough that the design feels coordinated instead of copied.

## Art Critique Pass

Before DXF, critique the thumbnail as if reviewing it for sale:

- Would this look professional as a black-line quilting product preview?
- Does the eye understand the focal point immediately?
- Are borders, blocks, triangles, and sashing different but related?
- Are the corners designed?
- Are motifs structurally attached?
- Is the negative space controlled?
- Does anything look procedural, childish, or random?

If the answer is no, revise thumbnails instead of digitizing.

## User-Approved Exemplar Loop

When the user approves a design as meeting the target standard, treat it as a benchmark for future work. Store only original, user-approved Codex outputs or user-permitted references; never store copied commercial artwork.

For each approved exemplar, record:

- What made it successful.
- Motif family.
- Composition template.
- Density band.
- Strongest geography.
- Weakest geography.
- What not to change in future iterations.

Future designs should be compared against these exemplars before DXF. If no approved exemplars exist yet, say so and rely on the curated motif/template library plus the user's uploaded target as qualitative guidance.

## Scoring Is Not Taste

`score_art_thumbnails.py` checks structural art-readiness. It does not prove beauty. A passing score means "worth reviewing or developing," not "ready for publication." If the visual still feels procedural, weak, childish, sparse, tangled, or unprofessional, revise the art direction even if the score passes.

`audit_artboard_quality.py` checks density, layer coverage, region occupancy, and obvious missing components. It still cannot prove professional beauty; it only prevents the Skill from treating a thin or underdeveloped art board as ready.

`critique_artboard_style.py` checks for professional art risks after the density audit: missing hierarchy, over-regular motif placement, stamped repetition outside repeat-friendly layers, weak focal occupancy, and border imbalance.

`machine_behavior_qa.py` checks whether the DXF contains geometry that may behave poorly on a computerized longarm: micro-segments, high-angle turns, tiny closed loops, and similar machine-motion risks. It records hotspot samples for reversals, cusps, micro-segments, and tiny segments with DXF coordinates, nearby segment lengths, and point indexes. When `--hotspot-png` is supplied, it also draws a visual stitch-flow overlay map with start marker, end marker, and direction arrows, plus any sampled hotspots. When `--seam-tangent-check` is supplied for repeatable borders, sashing, or row-chain outputs, it also records endpoint position, horizontal-plane delta, start/end needle heading, and seam tangent delta so a position-correct repeat with a visible hitch can still be caught. Use those samples and maps to inspect specific motif tips, transitions, entry/exit behavior, and stitch direction before revising a whole component. It is not a replacement for a real machine test.

`longarm_geometry.soften_hard_turns()` is the native-builder cleanup pass for decorative U-turns that are visually intentional but too abrupt for smooth computerized-longarm motion. Use it only after the motif path is drafted and before export, with a tiny radius relative to stitch spacing, so leaves, rosettes, scrolls, and triangle plumes keep their drawn character while avoiding exact needle pivots. Prefer pairing it with better motif construction, such as rounded leaf caps and rosette hub routing, rather than using it to rescue poorly planned travel.

`route_continuous_paths.py` produces a diagnostic route order and travel manifest. If travel is long or exposed, revise the artwork so travel becomes a designed vine, pearl chain, frame, echo, rail, or connector motif. Do not hide long travel by calling the design continuous.

`compile_continuous_path.py` turns selected DXF layers or component files into a one-polyline stitch candidate. Use it for borders, blocks, sashing strips, triangles, and focal components after the art passes visual review. Prefer compiling a true production component or repeat window with `--x-min`, `--x-max`, `--y-min`, and `--y-max`; a whole decorative layer is often too broad and will create visually obvious travel. Use `--force-connector` when the default anchor grammar chooses a connector that is too decorative for the component. The compiler is not proof that the connector art is good; review any connector flagged in the manifest and reject compiled previews with shortcut-looking diagonals or exposed travel. Whole-art-board compilation is diagnostic unless the quilt is meant to stitch as one uninterrupted file.

`build_native_border_repeat.py` is the fallback when compilation proves the source motifs were not designed with graceful anchors. It drafts a border repeat as one stitch path from the start, with same-plane endpoints and a chained preview. Use native component drafting as the preferred next move when a compiled path is mechanically correct but visually reads as repaired travel.

`build_native_corner_turn.py` completes the native border competency. It drafts a corner turn as one stitch path from a horizontal border baseline to a vertical border baseline, and emits a border-corner-side chain preview. Use it after a straight native border repeat; reject a corner that reads as a diagonal connector, a cropped straight repeat, or a pasted motif.

`build_native_setting_triangle.py` drafts a setting-triangle component around its actual geography: broad-edge entry, diagonal/V-shaped flow, inward feather or leaf plumes, secondary echo leaves, a softened point, broad-edge exit, and a mirrored companion. Use it when compiled triangle components or cropped block motifs read as repaired travel. Reject triangle outputs with floating interior motifs, long exposed stems, literal flowers crowded into the point, or a bare V spine with too little designed fill.

`build_native_sashing_rail.py` drafts quiet chainable sashing as its own geography: centerline vine, restrained curls, small alternating leaves, horizontal repeat, chained stress-test DXF, and vertical companion. Use it when a sashing strip should coordinate with borders and blocks without becoming another focal design. Its PNG previews center the stitched line inside the review canvas so narrow strips do not appear crowded against an edge. Reject outputs that become dense ropes, miniature borders, visible repeat ticks, off-center preview strips, or plain travel lines.

`build_native_block_component.py` drafts a square block around a block-specific skeleton: soft diamond or frame, focal rosette, supporting leaves/scrolls, optional echoed heart, mirrored companion, and row-chain test. Use it when block components read as enlarged borders, loose vines passing through a square, or assembled motifs without containment. Reject outputs that cannot route out without naked travel or that lack a center/support hierarchy.

`build_native_focal_medallion.py` drafts the richest native coordinate component: focal rosette, lilted partial halo, hearts, leaves, scrolls, top flame/echo, closed lower-point route, and mirrored companion. Use it when the coordinate set needs a central motif that carries the full motif vocabulary. Reject focal outputs that look like enlarged support blocks, have weak centers, knot at the closure, or leave accidental empty regions.

`build_native_coordinate_set.py` is the package-level native competency check. It runs the native focal, border, corner, triangle, sashing, and block builders; strict-QA checks every production and stress-test DXF; applies seam tangent checks to chainable border, sashing, and row outputs; creates stitch-flow and hotspot overlay maps, a role-aware contact sheet, motif distribution, role-aware density review, native package art critique, optional baseline comparison with `--baseline-package`, `native-package-review-report.html`, and a bundle of editable DXFs. The contact sheet presents focal/block/triangle/corner components in larger panels and border/sashing components as full-width strip bands so narrow geographies are reviewed in the shape they will occupy on a quilt. Use it after the individual component grammar is acceptable, and inspect the review report before delivery so the contact sheet, art critique, density review, preview-framing metrics, seam/repeat join table, stitch-flow table, production-vs-stress machine-warning scope, machine-hotspot maps and coordinates, regression result, and component-level risks are visible together. Reject or revise a package if the role-aware review flags a component, a repeatable production seam join is flagged, stitch-flow overlays are missing, the native package critique fails, the report cannot be generated, the baseline comparison reports a regression, preview framing is visibly off-center, or the contact sheet shows copied-looking support motifs, a weak focal, mismatched density, or a corner/sashing/triangle that does not belong to the same design language.

`check_golden_acceptance.py` is the completion-audit gate for native coordinate packages. It reads `references/golden-acceptance-suite.md` and checks measurable award-benchmark readiness: full component scope, strict machine QA, clean seam joins, complete stitch-flow overlays, high art score, role-aware motif hierarchy, readable handoff artifacts, and clean regression comparison. Treat a pass as readiness for human visual comparison and machine testing, not as proof of publication quality or permission to imitate the benchmark quilts.

`make_native_package_report.py` creates a human-facing HTML review sheet from a native coordinate package manifest. Use it directly when reviewing an older package or when the package builder was run before report support existed.

`critique_native_coordinate_package.py` is the professional-risk critic for native coordinate packages. It checks required geographies, focal/support motif distribution, role-aware density, preview line presence and framing, focal-to-block development, line-character regularity, and machine-warning load, with machine warnings scoped into primary production DXFs versus companion stress-test repeats. Line character is judged at design scale so dense stitch sampling does not create false "mathematically smooth" warnings; the original stitch-point metrics remain available under `machine_scale` for safety context. Use the critic when the output still feels mathematical, underdeveloped, sparse, or awkwardly presented even though the DXFs are continuous. Treat warnings as review targets rather than proof of failure; treat failures as a reason to revise before delivery.

When the package critique flags a named component, improve the native generator rather than suppressing the warning. After any critique-driven art edit, rebuild the whole package and run `compare_native_coordinate_package.py` against the strongest prior package. Keep the candidate only if strict machine QA and art critique still pass, regression comparison reports no regressions, and the contact sheet shows a real improvement instead of density for its own sake.

`compare_native_coordinate_package.py` compares a native coordinate package with the best prior package or approved exemplar. It checks component coverage, strict QA status, seam-join coverage and flagged repeat joins, stitch-flow overlay coverage, native package art-critique score and warnings, motif vocabulary, role-aware density, component line character, drawn-line development, preview line presence and centering, and primary and companion machine-warning drift. Use it before presenting a new native coordinate package when a baseline exists, or pass the baseline directly to `build_native_coordinate_set.py --baseline-package` so the comparison is included in the manifest and package zip. Reject candidates that regress even when all individual DXFs still pass machine QA.

`compare_artboard_regression.py` protects against losing quality during iteration. Compare against the best prior approved or strongest candidate; reject a new version if it lowers focal development, weakens border occupancy, increases stamped repetition, or introduces machine-risk artifacts without a clear artistic reason.

If the benchmark preview passes audit but fails visual review, stop and document the art failure. Do not continue iterating procedural parameters indefinitely unless the changes are likely to address a named visual defect. When repeated procedural revisions still read as assembled primitives, the missing component is a curated artist-approved motif library, not another density threshold.

## DXF Conversion Rule

DXF conversion is a downstream production step. If the art direction is weak, a perfect continuous path only preserves weak art. Never use mechanical validity as a substitute for visual quality.
