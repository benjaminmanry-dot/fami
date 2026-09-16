# Golden Acceptance Suite

Use this suite when the user asks whether the Skill is complete, production-caliber, award-caliber, reference-grade, or ready to freeze. The suite is a benchmark and acceptance rubric, not a motif library.

Do not copy, trace, vectorize, or closely imitate any referenced quilt or quilting design. Public award pages may inform quality expectations, motif hierarchy, density, line character, and workmanship standards. Generated outputs must remain original.

## Benchmark Candidates

These entries are candidates for human visual comparison and future user-approved exemplars.

| ID | Source | Award / Role | Work | Maker / Quilter | Use As Benchmark For |
| --- | --- | --- | --- | --- | --- |
| hqf-2025-best-show | Houston International Quilt Festival 2025 | Best of Show | The Visitation | Ricky Tims | Whole-quilt narrative integration, original digitized quilting, motif-to-quilt support |
| hqf-2025-machine-artistry | Houston International Quilt Festival 2025 | Master Award for Machine Artistry | Tricuspid Biomorph #2 | Caryl Bryer Fallert-Gentry | Digitally planned line systems, organic repetition, controlled complexity |
| hqf-2025-contemporary | Houston International Quilt Festival 2025 | Master Award for Contemporary Artistry | Color My World | Karen Kay Buckley | Focal/support hierarchy, varied motif distribution, cohesive coordinate logic |
| aqs-2025-movable-workmanship | AQS QuiltWeek Paducah 2025 | Handi Quilter Best Movable Machine Workmanship | Supraspinatus's Swan Song | Margaret E. Solomon Gunn | Longarm workmanship, dense but legible background texture, confident curves |
| aqs-2025-wall-movable | AQS QuiltWeek Paducah 2025 | Best Wall Movable Machine Workmanship | Gracious Blues | Claire Wallace | Wall-scale longarm balance, border/control structure, restrained detail |
| aqs-2025-large-movable | AQS QuiltWeek Paducah 2025 | Large Quilts - Movable Machine Quilted, First Place | Royal Treasure | Marilyn Badger | Traditional richness, medallion/border coordination, heirloom density |
| aqs-2025-wall-category | AQS QuiltWeek Paducah 2025 | Wall Quilts - Movable Machine Quilted, First Place | Millefleur | Jan Hutchison | Floral density, wall-quilt readability, refined supporting textures |
| road-2025-frame | Road to California 2025 | Outstanding Machine Quilting Frame | Adventures of Aquamarine & Amethyst | Margaret Solomon Gunn | Frame-quilting flow, hand-guided longarm energy, colored-thread confidence |
| road-2024-frame | Road to California 2024 | Best Machine Quilting Frame | Eyes of the Forest | Margaret Solomon Gunn | Nature-based longarm movement, forest-vine rhythm, foreground/background support |
| quiltcon-2025-machine | QuiltCon 2025 | Best Machine Quilting | Raspberry Roulette | Audrey Esarey | Modern negative space, restraint, quilting that supports graphic structure |
| foq-2025-longarm | Festival of Quilts 2025 | Excellence in Longarm Quilting | Daisy | Helen Brookham and Sandy Chandler | International longarm excellence, two-person coordination, clarity at show scale |
| ihqs-2025-machine | Indiana Heritage Quilt Show 2025 | Exemplary Machine Quilting | Eyes of the Forest | Margaret Solomon Gunn | Machine-quilting excellence, motif continuity, dense natural texture |
| susan-manry-process | the textile designer design-process reference | Process benchmark | Mexican Stars design process | the textile designer | Drawing from quilt-top shapes, motif development, area-aware placement, continuous-line assembly |

## Source Links

- Houston International Quilt Festival 2025 judged show winners: https://www.quilts.com/quilt-festival/judged-show-winners-2025/
- AQS QuiltWeek Paducah 2025 award winners: https://www.americanquilter.com/quiltweek/aqs-quilt-contests/past-winners/paducah-2025-award-winners/
- Road to California 2025 award winners: https://online.roadtocalifornia.com/awardwinnersroad.php?con=38
- Road to California 2024 award winners: https://online.roadtocalifornia.com/awardwinnersroad.php?con=37
- QuiltCon 2025 winners gallery: https://www.quiltcon.com/quiltcon-home/winners/quiltcon-2025-winners
- Festival of Quilts 2025 winners list: https://www.thefestivalofquilts.co.uk/wp-content/uploads/2025/08/Winners-List-2025-1.pdf
- Indiana Heritage Quilt Show 2025 winners guide: https://static1.squarespace.com/static/5965642529687fe0ec2cb366/t/67cb13205f69b300af088589/1741361952207/IHQS-Winners-2025-Final.pdf
- the textile designer Mexican Stars design process: https://susanmanry.com/mexican-stars-quilt/

## Acceptance Rubric

A generated package can be considered golden-candidate only when it passes both measurable gates and human visual review.

Measurable gates:

- Full component scope is present for coordinate work: focal, border, corner, setting triangle, sashing, and block.
- Every production and stress-test DXF is one continuous stitch path and passes strict machine QA.
- No machine-warning failures, reversals, micro-segments, tiny closed loops, disconnected subpaths, or jump-dependent travel.
- Chainable outputs keep start and end on the same horizontal plane within 0.001 inch and have seam tangent delta of 10 degrees or less for golden review.
- Every QA target has a start/end/direction stitch-flow overlay.
- Art critique score is at least 95, with no hard failures and no unresolved warnings for production targets.
- Motif hierarchy is clear: focal contains the richest vocabulary; supporting components omit some motifs and vary scale, rhythm, or role.
- Density is role-aware and balanced across geographies without making sashing or narrow pieces visually heavier than focal work.
- Contact sheet is readable, centered, and role-aware; border and sashing are shown as strips.
- Regression comparison against the strongest approved or prior candidate reports no regressions.
- DXF bundle, manifest, review report, contact sheet, QA JSON files, and overlay maps are present.

Human visual review:

- Stand the contact sheet beside the benchmark sources and ask whether the generated design has comparable intentionality, not comparable imagery.
- Look for quilt-aware design logic: motif placement should support boundaries, frames, centers, diagonals, and negative space.
- Reject mathematically stamped repetition, formula hearts, identical scrolls, exposed connector travel, and icons joined by convenience paths.
- Reject extra density that improves numeric coverage while weakening elegance or machine confidence.
- Treat a script pass as a readiness signal, not final publication approval.

## Scripted Check

Run the golden acceptance check after generating a candidate package:

```bash
python scripts/check_golden_acceptance.py ./native-coordinate-set --out ./native-coordinate-set/golden-acceptance-check.json
```

The script validates the measurable gates above and emits a JSON report. The generated package still needs human art approval and real machine testing before it can become an approved golden exemplar.
