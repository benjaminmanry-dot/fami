#!/usr/bin/env python3
"""Build a native continuous-line coordinate set for computerized longarm quilting."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent


def rel(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def write_log(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text or "", encoding="utf-8")


def run_command(command: list[str], log_stem: Path) -> dict:
    completed = subprocess.run(command, text=True, capture_output=True)
    write_log(log_stem.with_suffix(".stdout.txt"), completed.stdout)
    write_log(log_stem.with_suffix(".stderr.txt"), completed.stderr)
    return {
        "command": command,
        "returncode": completed.returncode,
        "stdout_log": log_stem.with_suffix(".stdout.txt"),
        "stderr_log": log_stem.with_suffix(".stderr.txt"),
    }


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def seam_tangent_target(component_id: str, dxf: str) -> bool:
    name = Path(dxf).name
    return component_id == "border-repeat" or name in {
        "native-sakura-leaf-sashing-rail.dxf",
        "native-sakura-leaf-sashing-rail-chained.dxf",
        "native-sakura-diamond-block-row.dxf",
    }


def make_contact_sheet(out_dir: Path, items: list[dict], sheet_path: Path) -> bool:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except Exception:
        return False

    existing = [item for item in items if item["path"].exists()]
    if not existing:
        return False

    sheet_w = 1800
    large_cell_w = sheet_w // 2
    large_cell_h = 620
    strip_cell_h = 250
    pad = 36
    label_h = 42
    by_id = {item["id"]: item for item in existing}
    used: set[str] = set()
    rows: list[dict] = []

    def add_large_row(component_ids: list[str]) -> None:
        row_items = [by_id[component_id] for component_id in component_ids if component_id in by_id]
        if row_items:
            rows.append({"kind": "large", "height": large_cell_h, "items": row_items[:2]})
            used.update(item["id"] for item in row_items[:2])

    def add_strip_row(component_id: str) -> None:
        if component_id in by_id:
            rows.append({"kind": "strip", "height": strip_cell_h, "items": [by_id[component_id]]})
            used.add(component_id)

    add_large_row(["focal-medallion", "block-component"])
    add_strip_row("border-repeat")
    add_large_row(["corner-turn", "setting-triangle"])
    add_strip_row("sashing-rail")

    remaining = [item for item in existing if item["id"] not in used]
    for index in range(0, len(remaining), 2):
        rows.append({"kind": "large", "height": large_cell_h, "items": remaining[index:index + 2]})

    sheet_h = sum(row["height"] for row in rows)
    image = Image.new("RGB", (sheet_w, sheet_h), (247, 247, 244))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()

    def paste_panel(item: dict, x0: int, y0: int, cell_w: int, cell_h: int) -> None:
        label = item["label"]
        path = item["path"]
        draw.rectangle((x0, y0, x0 + cell_w - 1, y0 + cell_h - 1), outline=(212, 208, 200), width=2)
        draw.text((x0 + pad, y0 + 18), label, fill=(24, 54, 68), font=font)
        with Image.open(path) as raw:
            preview = raw.convert("RGB")
        max_w = cell_w - pad * 2
        max_h = cell_h - pad * 2 - label_h
        scale = min(max_w / preview.width, max_h / preview.height)
        new_size = (max(1, int(preview.width * scale)), max(1, int(preview.height * scale)))
        try:
            resample = Image.Resampling.LANCZOS
        except AttributeError:
            resample = Image.LANCZOS
        preview = preview.resize(new_size, resample)
        px = x0 + (cell_w - preview.width) // 2
        py = y0 + label_h + (cell_h - label_h - preview.height) // 2
        image.paste(preview, (px, py))

    y0 = 0
    for row in rows:
        if row["kind"] == "strip":
            paste_panel(row["items"][0], 0, y0, sheet_w, row["height"])
        else:
            for index, item in enumerate(row["items"]):
                paste_panel(item, index * large_cell_w, y0, large_cell_w, row["height"])
            if len(row["items"]) == 1:
                draw.rectangle((large_cell_w, y0, sheet_w - 1, y0 + row["height"] - 1), outline=(212, 208, 200), width=2)
        y0 += row["height"]

    image.save(sheet_path)
    return True


def run_qa(out_dir: Path, qa_targets: list[dict]) -> tuple[list[dict], bool]:
    qa_dir = out_dir / "qa"
    hotspot_dir = qa_dir / "hotspots"
    logs_dir = out_dir / "logs"
    qa_dir.mkdir(parents=True, exist_ok=True)
    hotspot_dir.mkdir(parents=True, exist_ok=True)
    all_passed = True
    results: list[dict] = []

    for target in qa_targets:
        dxf_path = out_dir / target["dxf"]
        qa_path = qa_dir / f"{target['id']}.json"
        hotspot_path = hotspot_dir / f"{target['id']}.png"
        log_stem = logs_dir / f"qa-{target['id']}"
        if not dxf_path.exists():
            all_passed = False
            result = {
                "id": target["id"],
                "component": target["component"],
                "dxf": target["dxf"],
                "qa_json": rel(qa_path, out_dir),
                "seam_tangent_check": bool(target.get("seam_tangent_check")),
                "passes": False,
                "failures": ["DXF target is missing."],
                "warnings": [],
            }
            qa_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
            results.append(result)
            continue

        command = [
            sys.executable,
            str(SCRIPT_DIR / "machine_behavior_qa.py"),
            str(dxf_path),
            "--strict-continuous",
            "--out",
            str(qa_path),
            "--hotspot-png",
            str(hotspot_path),
        ]
        if target.get("seam_tangent_check"):
            command.extend(
                [
                    "--seam-tangent-check",
                    "--max-seam-tangent-delta",
                    "45",
                    "--max-start-end-y-delta",
                    "0.001",
                ]
            )
        run = run_command(command, log_stem)
        try:
            payload = load_json(qa_path)
        except Exception:
            payload = {
                "passes": False,
                "failures": ["QA output could not be parsed."],
                "warnings": [],
                "metrics": {},
            }
        if hotspot_path.exists():
            payload.setdefault("metrics", {})["hotspot_preview"] = rel(hotspot_path, out_dir)
            qa_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        passed = bool(payload.get("passes")) and run["returncode"] == 0
        all_passed = all_passed and passed
        results.append(
            {
                "id": target["id"],
                "component": target["component"],
                "dxf": target["dxf"],
                "qa_json": rel(qa_path, out_dir),
                "seam_tangent_check": bool(target.get("seam_tangent_check")),
                "passes": passed,
                "failures": payload.get("failures", []),
                "warnings": payload.get("warnings", []),
                "metrics": payload.get("metrics", {}),
                "thresholds": payload.get("thresholds", {}),
                "stdout_log": rel(run["stdout_log"], out_dir),
                "stderr_log": rel(run["stderr_log"], out_dir),
            }
        )

    return results, all_passed


def package_outputs(out_dir: Path, zip_path: Path, manifest_path: Path, contact_sheet: Path | None, report_path: Path | None) -> None:
    package_files: list[Path] = []
    for pattern in ("**/*.dxf", "qa/*.json", "qa/hotspots/*.png", "native-package-art-critique.json", "native-package-regression-comparison.json"):
        package_files.extend(sorted(out_dir.glob(pattern)))
    package_files.append(manifest_path)
    if contact_sheet and contact_sheet.exists():
        package_files.append(contact_sheet)
    if report_path and report_path.exists():
        package_files.append(report_path)

    seen: set[Path] = set()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in package_files:
            if not path.exists() or path in seen:
                continue
            seen.add(path)
            zf.write(path, arcname=rel(path, out_dir))


def density_summary(specs: list[dict], qa_results: list[dict]) -> dict | None:
    if not qa_results:
        return None

    by_dxf = {item["dxf"]: item for item in qa_results}
    items: list[dict] = []
    for spec in specs:
        primary = spec["dxf_files"][0]
        qa = by_dxf.get(primary)
        if not qa or not qa.get("metrics"):
            continue
        metrics = qa["metrics"]
        min_x, min_y, max_x, max_y = metrics.get("bounds", [0, 0, 0, 0])
        width = max(0.01, max_x - min_x)
        height = max(0.01, max_y - min_y)
        area = width * height
        length = float(metrics.get("total_drawn_length", 0.0))
        items.append(
            {
                "component": spec["id"],
                "geography": spec["geography"],
                "primary_dxf": primary,
                "density_role": spec["density_role"],
                "drawn_length": round(length, 4),
                "bounds_area": round(area, 4),
                "line_density": round(length / area, 4),
            }
        )

    if not items:
        return None

    densities = sorted(item["line_density"] for item in items)
    median = densities[len(densities) // 2]
    if len(densities) % 2 == 0:
        median = (densities[len(densities) // 2 - 1] + densities[len(densities) // 2]) / 2
    median = max(0.0001, median)
    for item in items:
        ratio = item["line_density"] / median
        item["relative_to_median"] = round(ratio, 3)
        if ratio < 0.78:
            item["density_band"] = "quiet"
        elif ratio > 1.35:
            item["density_band"] = "dense"
        else:
            item["density_band"] = "balanced"

    review_flags: list[str] = []
    for item in items:
        ratio = item["relative_to_median"]
        component = item["component"]
        if component == "focal-medallion" and ratio < 0.8:
            review_flags.append("Focal medallion may be too quiet compared with support geographies.")
        elif component in {"border-repeat", "setting-triangle", "block-component"} and (ratio < 0.6 or ratio > 1.85):
            review_flags.append(f"{item['geography']} is outside the expected support density band.")
        elif component == "corner-turn" and ratio < 0.32:
            review_flags.append("Corner turn may be too sparse to coordinate with the border.")
        elif component == "sashing-rail" and ratio > 3.2:
            review_flags.append("Sashing rail may be too dense for a quiet support strip.")

    spread = max(item["relative_to_median"] for item in items) - min(item["relative_to_median"] for item in items)
    return {
        "method": "Primary component drawn length divided by bounding-box area; use as a cohesion proxy, not a beauty score.",
        "median_line_density": round(median, 4),
        "density_proxy_spread": round(spread, 3),
        "role_aware_balance_passed": not review_flags,
        "review_flags": review_flags,
        "items": items,
        "review_note": "Quiet support pieces may intentionally differ from focal pieces; review the contact sheet before changing art only to satisfy a number.",
    }


def component_specs(args: argparse.Namespace, out_dir: Path) -> list[dict]:
    py = sys.executable
    return [
        {
            "id": "focal-medallion",
            "script": "build_native_focal_medallion.py",
            "directory": "focal-medallion",
            "command": [
                py,
                str(SCRIPT_DIR / "build_native_focal_medallion.py"),
                "--name",
                "Native Sakura Focal Medallion",
                "--out",
                str(out_dir / "focal-medallion"),
                "--size",
                str(args.focal_size),
                "--stitch-spacing",
                str(args.stitch_spacing),
            ],
            "geography": "focal medallion",
            "density_role": "richest focal statement",
            "motifs": ["sakura rosette", "halo", "echo heart", "leaves", "scrolls", "top flame"],
            "omitted_motifs": [],
            "preview": "focal-medallion/native-sakura-focal-medallion.png",
            "dxf_files": [
                "focal-medallion/native-sakura-focal-medallion.dxf",
                "focal-medallion/native-sakura-focal-medallion-mirrored.dxf",
            ],
        },
        {
            "id": "border-repeat",
            "script": "build_native_border_repeat.py",
            "directory": "border-repeat",
            "command": [
                py,
                str(SCRIPT_DIR / "build_native_border_repeat.py"),
                "--name",
                "Native Sakura Heart Border Repeat",
                "--out",
                str(out_dir / "border-repeat"),
                "--width",
                str(args.border_width),
                "--stitch-spacing",
                str(args.stitch_spacing),
            ],
            "geography": "straight border repeat",
            "density_role": "rhythmic border support",
            "motifs": ["open heart", "leaves", "scrolls", "vine"],
            "omitted_motifs": ["focal rosette", "halo", "top flame"],
            "preview": "border-repeat/native-sakura-heart-border-repeat-chained.png",
            "dxf_files": ["border-repeat/native-sakura-heart-border-repeat.dxf"],
        },
        {
            "id": "corner-turn",
            "script": "build_native_corner_turn.py",
            "directory": "corner-turn",
            "command": [
                py,
                str(SCRIPT_DIR / "build_native_corner_turn.py"),
                "--name",
                "Native Sakura Heart Corner Turn",
                "--out",
                str(out_dir / "corner-turn"),
                "--size",
                str(args.corner_size),
                "--stitch-spacing",
                str(args.stitch_spacing),
                "--top-repeats",
                str(args.corner_top_repeats),
                "--side-repeats",
                str(args.corner_side_repeats),
            ],
            "geography": "corner turn",
            "density_role": "turn logic and border transition",
            "motifs": ["corner heart", "turning vine", "scrolls", "leaves"],
            "omitted_motifs": ["full focal rosette", "halo"],
            "preview": "corner-turn/native-border-corner-chain.png",
            "dxf_files": [
                "corner-turn/native-sakura-heart-corner-turn.dxf",
                "corner-turn/native-border-corner-chain.dxf",
            ],
        },
        {
            "id": "setting-triangle",
            "script": "build_native_setting_triangle.py",
            "directory": "setting-triangle",
            "command": [
                py,
                str(SCRIPT_DIR / "build_native_setting_triangle.py"),
                "--name",
                "Native Sakura Feather Setting Triangle",
                "--out",
                str(out_dir / "setting-triangle"),
                "--width",
                str(args.triangle_width),
                "--depth",
                str(args.triangle_depth),
                "--stitch-spacing",
                str(args.stitch_spacing),
            ],
            "geography": "setting triangle",
            "density_role": "tapered diagonal support",
            "motifs": ["feather plume", "leaves", "scrolls", "softened point"],
            "omitted_motifs": ["heart", "focal rosette", "halo"],
            "preview": "setting-triangle/native-sakura-feather-setting-triangle.png",
            "dxf_files": [
                "setting-triangle/native-sakura-feather-setting-triangle.dxf",
                "setting-triangle/native-sakura-feather-setting-triangle-mirrored.dxf",
            ],
        },
        {
            "id": "sashing-rail",
            "script": "build_native_sashing_rail.py",
            "directory": "sashing-rail",
            "command": [
                py,
                str(SCRIPT_DIR / "build_native_sashing_rail.py"),
                "--name",
                "Native Sakura Leaf Sashing Rail",
                "--out",
                str(out_dir / "sashing-rail"),
                "--width",
                str(args.sashing_width),
                "--height",
                str(args.sashing_height),
                "--stitch-spacing",
                str(args.stitch_spacing),
                "--repeats",
                str(args.sashing_repeats),
            ],
            "geography": "sashing rail",
            "density_role": "quiet connective strip",
            "motifs": ["center vine", "small leaves", "restrained curls"],
            "omitted_motifs": ["heart", "focal rosette", "halo", "top flame"],
            "preview": "sashing-rail/native-sakura-leaf-sashing-rail-chained.png",
            "dxf_files": [
                "sashing-rail/native-sakura-leaf-sashing-rail.dxf",
                "sashing-rail/native-sakura-leaf-sashing-rail-chained.dxf",
                "sashing-rail/native-sakura-leaf-sashing-rail-vertical.dxf",
            ],
        },
        {
            "id": "block-component",
            "script": "build_native_block_component.py",
            "directory": "block-component",
            "command": [
                py,
                str(SCRIPT_DIR / "build_native_block_component.py"),
                "--name",
                "Native Sakura Diamond Block",
                "--out",
                str(out_dir / "block-component"),
                "--size",
                str(args.block_size),
                "--stitch-spacing",
                str(args.stitch_spacing),
                "--row-repeats",
                str(args.block_row_repeats),
            ],
            "geography": "supporting block",
            "density_role": "contained block motif",
            "motifs": ["diamond skeleton", "sakura rosette", "echo heart", "leaves", "scrolls"],
            "omitted_motifs": ["halo", "top flame"],
            "preview": "block-component/native-sakura-diamond-block-row.png",
            "dxf_files": [
                "block-component/native-sakura-diamond-block.dxf",
                "block-component/native-sakura-diamond-block-mirrored.dxf",
                "block-component/native-sakura-diamond-block-row.dxf",
            ],
        },
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Native Sakura Coordinate Set")
    parser.add_argument("--out", required=True)
    parser.add_argument("--stitch-spacing", type=float, default=0.025)
    parser.add_argument("--focal-size", type=float, default=8.0)
    parser.add_argument("--border-width", type=float, default=6.0)
    parser.add_argument("--corner-size", type=float, default=6.0)
    parser.add_argument("--corner-top-repeats", type=int, default=2)
    parser.add_argument("--corner-side-repeats", type=int, default=2)
    parser.add_argument("--triangle-width", type=float, default=6.0)
    parser.add_argument("--triangle-depth", type=float, default=5.0)
    parser.add_argument("--sashing-width", type=float, default=8.0)
    parser.add_argument("--sashing-height", type=float, default=1.5)
    parser.add_argument("--sashing-repeats", type=int, default=5)
    parser.add_argument("--block-size", type=float, default=6.0)
    parser.add_argument("--block-row-repeats", type=int, default=3)
    parser.add_argument("--baseline-package", help="Optional prior native coordinate package directory or manifest for regression comparison.")
    parser.add_argument("--skip-qa", action="store_true")
    parser.add_argument("--skip-art-critique", action="store_true")
    parser.add_argument("--skip-report", action="store_true")
    parser.add_argument("--no-contact-sheet", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = out_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    specs = component_specs(args, out_dir)
    component_runs = []
    component_passed = True

    for spec in specs:
        run = run_command(spec["command"], logs_dir / f"build-{spec['id']}")
        component_passed = component_passed and run["returncode"] == 0
        component_runs.append(
            {
                "id": spec["id"],
                "script": spec["script"],
                "returncode": run["returncode"],
                "stdout_log": rel(run["stdout_log"], out_dir),
                "stderr_log": rel(run["stderr_log"], out_dir),
            }
        )

    qa_targets = [
        {
            "id": f"{spec['id']}-{Path(dxf).stem}",
            "component": spec["id"],
            "dxf": dxf,
            "seam_tangent_check": seam_tangent_target(spec["id"], dxf),
        }
        for spec in specs
        for dxf in spec["dxf_files"]
    ]
    qa_results: list[dict] = []
    qa_passed = True
    if not args.skip_qa:
        qa_results, qa_passed = run_qa(out_dir, qa_targets)

    contact_sheet = out_dir / "native-sakura-coordinate-set-contact-sheet.png"
    contact_sheet_created = False
    if not args.no_contact_sheet:
        contact_sheet_created = make_contact_sheet(
            out_dir,
            [
                {
                    "id": spec["id"],
                    "label": spec["geography"].title(),
                    "path": out_dir / spec["preview"],
                }
                for spec in specs
            ],
            contact_sheet,
        )

    density = density_summary(specs, qa_results)
    components = []
    for spec in specs:
        related_qa = [item for item in qa_results if item["component"] == spec["id"]]
        components.append(
            {
                "id": spec["id"],
                "geography": spec["geography"],
                "directory": spec["directory"],
                "density_role": spec["density_role"],
                "motifs": spec["motifs"],
                "omitted_motifs": spec["omitted_motifs"],
                "preview": spec["preview"],
                "dxf_files": spec["dxf_files"],
                "qa": related_qa,
                "review_note": "Review visually before customer release; strict QA checks machine behavior, not beauty.",
            }
        )

    manifest_path = out_dir / "native-sakura-coordinate-set-manifest.json"
    package_zip = out_dir / "native-sakura-coordinate-set-dxf.zip"
    manifest = {
        "name": args.name,
        "type": "native continuous-line coordinate set",
        "art_status": "draft native coordinate package requiring human art approval and machine test",
        "machine_status": "strict QA passed" if component_passed and qa_passed else "review required",
        "stitch_spacing": args.stitch_spacing,
        "component_builds_passed": component_passed,
        "strict_machine_qa_passed": qa_passed,
        "art_critique_passed": None,
        "art_critique": None,
        "regression_comparison_passed": None,
        "regression_comparison": None,
        "review_report": None,
        "density_summary": density,
        "contact_sheet": rel(contact_sheet, out_dir) if contact_sheet_created else None,
        "contact_sheet_layout": {
            "mode": "role-aware review board",
            "large_panel_order": ["focal-medallion", "block-component", "corner-turn", "setting-triangle"],
            "strip_band_order": ["border-repeat", "sashing-rail"],
            "review_note": "Border and sashing previews are shown as full-width bands so narrow geographies stay readable in the contact sheet.",
        },
        "dxf_package": rel(package_zip, out_dir),
        "motif_distribution_rule": "The focal contains the full motif vocabulary; support geographies omit selected motifs while keeping similar density through echoes, leaves, scrolls, vines, and containment.",
        "components": components,
        "component_runs": component_runs,
        "quality_notes": [
            "All generated DXFs are single ordered polylines when strict QA passes.",
            "Borders and sashing include chained stress-test DXFs.",
            "Corners and triangles are native geographies, not cropped blocks.",
            "Passing QA does not replace longarm machine testing or final professional art approval.",
        ],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    art_critique_passed = True
    if not args.skip_art_critique:
        critique_path = out_dir / "native-package-art-critique.json"
        critique_run = run_command(
            [
                sys.executable,
                str(SCRIPT_DIR / "critique_native_coordinate_package.py"),
                str(manifest_path),
                "--out",
                str(critique_path),
            ],
            logs_dir / "art-critique-native-package",
        )
        try:
            critique_payload = load_json(critique_path)
        except Exception:
            critique_payload = {
                "passes": False,
                "score": 0,
                "failures": ["Art critique output could not be parsed."],
                "warnings": [],
            }
        art_critique_passed = bool(critique_payload.get("passes")) and critique_run["returncode"] == 0
        manifest["art_critique_passed"] = art_critique_passed
        manifest["art_critique"] = {
            "path": rel(critique_path, out_dir),
            "passes": art_critique_passed,
            "score": critique_payload.get("score"),
            "failures": critique_payload.get("failures", []),
            "warnings": critique_payload.get("warnings", []),
            "stdout_log": rel(critique_run["stdout_log"], out_dir),
            "stderr_log": rel(critique_run["stderr_log"], out_dir),
        }
        if not art_critique_passed:
            manifest["art_status"] = "review required after native package art critique"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    regression_passed = True
    if args.baseline_package:
        regression_path = out_dir / "native-package-regression-comparison.json"
        regression_run = run_command(
            [
                sys.executable,
                str(SCRIPT_DIR / "compare_native_coordinate_package.py"),
                "--candidate",
                str(manifest_path),
                "--baseline",
                str(Path(args.baseline_package)),
                "--out",
                str(regression_path),
            ],
            logs_dir / "regression-native-package",
        )
        try:
            regression_payload = load_json(regression_path)
        except Exception:
            regression_payload = {
                "passes": False,
                "winner": "needs-review",
                "regressions": ["Regression comparison output could not be parsed."],
                "improvements": [],
            }
        regression_passed = bool(regression_payload.get("passes")) and regression_run["returncode"] == 0
        manifest["regression_comparison_passed"] = regression_passed
        manifest["regression_comparison"] = {
            "path": rel(regression_path, out_dir),
            "baseline": str(Path(args.baseline_package)),
            "passes": regression_passed,
            "winner": regression_payload.get("winner"),
            "regressions": regression_payload.get("regressions", []),
            "improvements": regression_payload.get("improvements", []),
            "stdout_log": rel(regression_run["stdout_log"], out_dir),
            "stderr_log": rel(regression_run["stderr_log"], out_dir),
        }
        if not regression_passed:
            manifest["art_status"] = "review required after native package regression comparison"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    report_path = out_dir / "native-package-review-report.html"
    report_passed = True
    if not args.skip_report:
        report_run = run_command(
            [
                sys.executable,
                str(SCRIPT_DIR / "make_native_package_report.py"),
                str(manifest_path),
                "--out",
                str(report_path),
            ],
            logs_dir / "native-package-report",
        )
        report_passed = report_run["returncode"] == 0 and report_path.exists()
        manifest["review_report"] = {
            "path": rel(report_path, out_dir),
            "passes": report_passed,
            "stdout_log": rel(report_run["stdout_log"], out_dir),
            "stderr_log": rel(report_run["stderr_log"], out_dir),
        }
        if not report_passed:
            manifest["art_status"] = "review required because the package report could not be generated"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    package_outputs(out_dir, package_zip, manifest_path, contact_sheet if contact_sheet_created else None, report_path if not args.skip_report else None)

    summary = {
        "out": str(out_dir),
        "manifest": str(manifest_path),
        "contact_sheet": str(contact_sheet) if contact_sheet_created else None,
        "review_report": str(report_path) if not args.skip_report else None,
        "dxf_package": str(package_zip),
        "component_builds_passed": component_passed,
        "strict_machine_qa_passed": qa_passed,
        "art_critique_passed": art_critique_passed,
        "regression_comparison_passed": regression_passed if args.baseline_package else None,
        "report_passed": report_passed if not args.skip_report else None,
        "component_count": len(specs),
        "qa_target_count": len(qa_targets) if not args.skip_qa else 0,
    }
    print(json.dumps(summary, indent=2))
    return 0 if component_passed and qa_passed and art_critique_passed and regression_passed and report_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
