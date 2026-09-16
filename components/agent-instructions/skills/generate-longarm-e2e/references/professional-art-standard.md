# Professional Art Standard

Use this reference whenever the user asks for professional, heirloom, coordinate, custom, complex, publishable, or the textile designer-quality longarm quilting artwork.

This standard is source-informed by SusanManry.com, but the output must remain original. Do not copy, recreate, trace, or closely imitate protected the textile designer patterns. Use the references as process and vocabulary cues: plan over the quilt, build motifs from inspiration, place designs accurately in areas, and convert approved artwork into continuous-line stitch paths.

## Source-Informed Process Cues

- the textile designer's Mexican Stars process starts with a photo backdrop, identifies the quilt top's natural curves, chooses motifs from piecing and fabric, moves/rotates/resizes/multiplies parts, then combines finished interior designs into continuous-line stitching designs.
- Her custom quilting materials emphasize precise placement in blocks, borders, triangles, and other quilt parts. The area must be set around the perimeter of the actual geography, not across it.
- Complex or irregular shapes need enough area points to match the piecing. Simple four-point placement is not enough when ditches bow, scallop, or deviate.
- The Sunflower Love project workflow uses separate design pieces such as outer border, pearl border, inner border, triangle, flourish, flower echo, flower pearl combination, and flower. Treat this as evidence of layered composition, not a pattern to copy.
- Her Pro-Stitcher material repeatedly emphasizes simulation, wrapping, offsetting, seamless borders and corners, effective areas, alignment, resizing, rotation, cropping, and restarting.

## Required Art-Board Workflow

For coordinate designs and high-art requests, do not begin by drafting DXF waypoints. Create a composed art board first.

1. Map the quilt geographies: outer border, inner border, focal block, blocks, setting triangles, corner triangles, sashing, background fills, and any irregular areas.
2. Select a master composition template from `composition-templates.md` and `assets/artistic-library/templates.json`.
3. Select curated motifs from `assets/artistic-library/motifs.json`; use `susan-manry-informed-motif-library.md` for vocabulary and usage rules.
4. Generate 3 to 6 art-direction thumbnails and score them. Reject any thumbnail below 85 or with hard failures.
5. Assign each geography a boundary-aware skeleton: border spine, block medallion, diagonal triangle flow, sashing chain, corner turn, or framed fill.
6. Build a motif distribution plan. The focal area may contain the full family; supporting areas contain selected pieces, not everything.
7. Set a density band and line-spacing target for each geography. Adjacent areas should read similar in quilting effect even when motif scale differs.
8. Render or describe a full art-board preview before DXF. Include boundaries, motif placements, echo/pearl layers, corner handling, and negative-space rhythm.
9. Reject the art board if it reads as icons connected by travel lines.
10. Digitize only after the art board passes the professional quality gate.

## Composition Requirements

- The design must feel planned from the quilt outward. Motifs should lock into seams, frames, corners, spines, or boundaries.
- A coordinate set should read as one collection spread across the quilt, not as unrelated motifs in separate boxes.
- Borders need layered structure: outer containment, primary rhythm, optional pearl/echo band, and inner containment.
- Corners must turn intentionally. Do not crop a straight border into a corner and call it finished.
- Blocks need a complete internal composition: center, frame, corner interest, and controlled negative space.
- Triangles need diagonal or radial flow that tapers into the point. Do not squeeze a square motif into a triangle.
- Sashing should be quieter than focal blocks but should carry at least one shared grammar, such as pearls, leaves, small hearts, curls, or ribbon.
- Focal designs can be ornate. Supporting designs should be simpler but recognizably related.

## Linework Requirements

- Use smooth longarm-friendly curves with confident control points.
- Prefer echoed shapes, pearl chains, scroll pairs, leaf chains, feathers, and framed fills over literal clip-art outlines.
- Keep connector travel visually absorbed into the design. A connector should read as a vine, curl, echo, pearl chain, feather stem, or frame segment.
- Do not leave long naked travel lines through open space.
- Avoid jitter, point noise, tiny uncontrolled reversals, and over-dense stitch clusters.
- Maintain comparable line spacing within the chosen density band.

## Density Requirements

Use the same density band across the coordinate set unless the user asks for deliberate contrast.

- Open: 0.050 to 0.070 inch stitch spacing, larger negative spaces, minimal echoing.
- Medium: 0.035 to 0.050 inch stitch spacing, moderate echoes, pearls, curls, or leaves.
- Dense: 0.025 to 0.035 inch stitch spacing, heirloom-style detail, careful machine testing required.

For coordinate sets, judge density by visual effect rather than motif count. A triangle with fewer motifs can match a block if it has similar echo spacing and fill rhythm.

## Professional Quality Gate

Before DXF, answer yes to each item:

- Does every geography have a planned skeleton?
- Does each motif belong to a frame, spine, corner, or boundary?
- Are focal and support areas similar in density but different in motif mix?
- Are corners, triangles, borders, and blocks designed for their actual shapes?
- Does the focal area carry the richest motif statement?
- Do support areas repeat some motifs while omitting others?
- Are pearl chains, echoes, scrolls, hearts, flowers, feathers, or fills used as quilting grammar rather than decoration pasted on top?
- Is negative space intentional and balanced?
- Could the design be shown as a sellable coordinate collection before stitch conversion?
- Did the chosen thumbnail score at least 85 with no hard failures?
- Does the design use curated motif assets and a master template rather than ad hoc procedural primitives?

Reject and revise when:

- The design looks like icons joined by lines.
- Motifs float without a border, frame, spine, or area relationship.
- Borders are plain repeats with no corner strategy.
- Triangles are cropped blocks.
- All support areas contain all motifs.
- One geography is much denser or emptier than its neighbors.
- The art would need apologizing before showing it to a professional longarm quilter.
- The art passes a numeric audit but still reads as procedural, over-knotted, childish, or mechanically assembled. In that case the correct result is "not production-ready," not a prettier summary.

## Current Procedural Limit

The built-in procedural generators can produce valid DXF geometry, density coverage, motif distribution, and coordinate-set structure. They cannot reliably produce reference-grade heirloom art from primitives alone. To reach the uploaded reference standard with high confidence, the Skill needs at least one of these inputs:

- A hand-curated, approved vector motif library with polished entry/exit anchors, echo variants, and area roles.
- A user-approved Codex exemplar that can be used as the local benchmark for composition and line quality.
- A human art pass that redraws or approves the motifs before final continuous-line digitizing.

Without one of those, deliver the strongest research draft and explicitly say that the art does not yet meet the professional reference standard.

## Digitizing Rule

After the art board passes, convert it into continuous-line paths. The digitized path must still meet the mechanical requirements in `SKILL.md`: one stitch stream, no hidden jumps, no backtracked travel, smooth curves, and correct start/end behavior for repeatable E2E rows.
