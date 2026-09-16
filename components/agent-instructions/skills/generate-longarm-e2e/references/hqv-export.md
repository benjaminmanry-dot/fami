# HQV Export

`.hqv` is a Pro-Stitcher vector motif format, but the public documentation does not provide a byte-level writer specification.

Use only one of these approaches:

- Current default: produce only an editable DXF handoff. The user will edit and publish final machine formats from that DXF.
- Export `.hqv` through Pro-Stitcher Designer, Pro-Stitcher Studio, Art and Stitch, or another verified converter.
- Configure `scripts/build_e2e_pattern.py` or `scripts/build_square_layout.py` with `--hqv-converter` or `LONGARM_HQV_CONVERTER`.
- If no converter is available, do not create a fake `.hqv`; deliver the DXF and state that `.hqv` must be exported from verified software.

Useful references:

- Pro-Stitcher support lists `HQF or HQV` for Handi Quilter Pro-Stitcher: https://support.prostitcher.com/hc/en-us/articles/17366819736731-What-longarm-executable-file-type-do-I-need
- Pro-Stitcher says it can read `.hqf`, `.hqv`, and `.qli` patterns: https://prostitcher.com/prostitcher/
- Handi Quilter announced `.hqv` as a vector file format for motifs: https://handiquilter.com/new-version-of-hq-pro-stitcher-available/
