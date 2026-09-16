# Coordinate Design Sets

Use this reference when creating a family of related computerized longarm designs for different quilt geographies: borders, blocks, setting triangles, corner triangles, sashing, focal blocks, alternate blocks, or background fills.

## Core Idea

A coordinate set should feel like one quilting collection spread across the quilt, not one motif repeated everywhere.

- The focal design contains the full motif library.
- Supporting designs contain some, but not all, of the focal motifs.
- Each geography should be similar in density, line quality, and style, but different in motif mix, scale emphasis, and connector rhythm.
- Repeated motif references tie the quilt together; omissions and substitutions keep it from getting boring.

Example motif library: star, heart, sunflower, tricycle.

- Focal block: star, heart, sunflower, tricycle.
- Border: sunflower, star, heart, plus vine/pearl connectors.
- Blocks: heart, star, smaller sunflower centers.
- Triangles: star points and sunflower petals, no tricycle.
- Sashing: small hearts and pearls only.
- Corner triangles: sunflower fragment and star echo.

## Density Matching

Match density by quilting effect, not by identical motif count.

- Keep comparable average spacing between stitch lines across geographies.
- Use similar echo counts, pearl size, background curl scale, and negative-space rhythm.
- Scale motifs down in triangles and sashing rather than packing them tighter.
- If one geography uses a large open focal motif, give adjacent areas slightly stronger connector fill so the quilt still reads balanced.
- Do not let borders become dense ropes while blocks remain airy, or triangles become crowded because they are small.

Use a target density band:

- Open: 0.05 to 0.07 in stitch spacing, larger negative spaces, few echoes.
- Medium: 0.035 to 0.05 in stitch spacing, moderate echoes or pearls.
- Dense: 0.025 to 0.035 in stitch spacing, small fill motifs, machine-test carefully.

## Geography Rules

- Border: Use a continuous directional spine, turn corners intentionally, and avoid clipped-looking motifs at the ends.
- Blocks: Let each block read as a complete thought; use one dominant motif plus supporting echoes or small secondary motifs.
- Triangles: Design for the triangular boundary. Use diagonal flow, partial motifs, and tapering echoes instead of forcing a square motif into a triangle.
- Sashing: Use simpler motifs, pearls, leaves, or small echoes. Sashing should coordinate, not compete.
- Focal block: Include the full motif library and the strongest visual statement.
- Alternate/background blocks: Use a reduced motif mix, often one focal motif plus one connector grammar.

## Motif Distribution Rules

- Do not put every motif in every geography.
- Do not make adjacent geographies identical unless the quilt specifically needs symmetry.
- Ensure each important motif appears in at least two places across the quilt.
- Use at least one shared connector grammar across the set: vine, ribbon, curl, pearl chain, feather spine, echo line, or geometric channel.
- Vary motif scale and orientation between geographies.
- When using novelty motifs, translate them into quilting shapes: silhouette fragments, wheels as pearls/circles, petals as echoes, stars as angular flourishes, hearts as curls.

## Professional Coordinate Artwork Workflow

1. Map the quilt geographies and approximate dimensions.
2. Define the motif library and pick the focal geography.
3. For professional, heirloom, custom, or the textile designer-quality requests, read `professional-art-standard.md` and `susan-manry-informed-motif-library.md`.
4. Generate 3 to 6 art-direction thumbnails with `scripts/generate_art_thumbnails.py`.
5. Score thumbnails with `scripts/score_art_thumbnails.py`; keep only directions scoring at least 85 with no hard failures.
6. Make an art-board plan with `scripts/plan_coordinate_artwork.py` before drawing stitch paths.
7. Give the focal geography every motif.
8. Give each support geography a subset of motifs, plus a shared connector grammar.
9. Set a density band and keep each geography within that band.
10. Assign each geography a boundary-aware skeleton: border spine, block medallion, diagonal triangle flow, sashing chain, corner turn, or framed fill.
11. Render or describe the full coordinate art board before DXF.
12. Draw each geography as its own continuous-line design and export editable DXF only after the art board passes review.
13. Inspect the family together: familiar, balanced, varied, and machine-stitchable.

Use `scripts/plan_coordinate_designs.py` only for quick motif distribution. Use `scripts/plan_coordinate_artwork.py` when art quality is the point.

## Quality Gate

Reject or revise a coordinate set when:

- Supporting designs all contain the full motif library.
- One geography is much denser or emptier than the others without a quilt-specific reason.
- Triangle or border designs look like cropped block designs.
- Motifs are distributed randomly instead of intentionally.
- The focal design does not feel more complete than the supporting designs.
- The set lacks a shared connector grammar.
- Any design requires jumps, stops, tie-offs, or hidden retraced travel.
- Motifs look like floating icons connected by exposed travel lines.
- A border, block, or triangle lacks its own skeleton.
- DXF generation begins before the art-board plan is approved.
- No scored thumbnail options were created.
- The chosen thumbnail scores below 85 or has hard failures.
