#!/usr/bin/env python3
"""Create a human review report for a native longarm coordinate package."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
from typing import Any

from compare_native_coordinate_package import visual_metrics


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def find_manifest(source: Path) -> Path:
    if source.is_file():
        return source
    preferred = source / "native-sakura-coordinate-set-manifest.json"
    if preferred.exists():
        return preferred
    matches = sorted(source.glob("*manifest*.json"))
    if matches:
        return matches[0]
    raise FileNotFoundError(f"No native package manifest found in {source}")


def package_root(manifest_path: Path) -> Path:
    return manifest_path.resolve().parent


def optional_payload(root: Path, value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        path = value.get("path")
    else:
        path = value
    if not path:
        return None
    payload_path = root / str(path)
    if not payload_path.exists():
        return None
    try:
        return load_json(payload_path)
    except Exception:
        return None


def esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def yes_no(value: Any) -> str:
    if value is True:
        return "Passed"
    if value is False:
        return "Review"
    return "Not run"


def status_class(value: Any) -> str:
    if value is True:
        return "pass"
    if value is False:
        return "warn"
    return "neutral"


def href(path: str | None) -> str:
    if not path:
        return ""
    return esc(path.replace("\\", "/"))


def joined(items: list[Any], fallback: str = "None") -> str:
    clean = [str(item) for item in items if str(item).strip()]
    return esc(", ".join(clean) if clean else fallback)


def list_block(items: list[Any], css_class: str = "") -> str:
    if not items:
        return '<p class="muted">None recorded.</p>'
    rows = "\n".join(f"<li>{esc(item)}</li>" for item in items)
    klass = f' class="{esc(css_class)}"' if css_class else ""
    return f"<ul{klass}>\n{rows}\n</ul>"


def qa_totals(components: list[dict[str, Any]]) -> dict[str, int]:
    totals = {
        "targets": 0,
        "passed": 0,
        "warnings": 0,
        "failures": 0,
        "reversals": 0,
        "cusps": 0,
        "micro_segments": 0,
    }
    for component in components:
        for item in component.get("qa", []):
            totals["targets"] += 1
            totals["passed"] += 1 if item.get("passes") else 0
            totals["warnings"] += len(item.get("warnings", []))
            totals["failures"] += len(item.get("failures", []))
            metrics = item.get("metrics", {})
            totals["reversals"] += int(metrics.get("reversal_turn_count", 0) or 0)
            totals["cusps"] += int(metrics.get("cusp_turn_count", 0) or 0)
            totals["micro_segments"] += int(metrics.get("micro_segment_count", 0) or 0)
    return totals


def density_by_component(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    density = manifest.get("density_summary") or {}
    return {item.get("component"): item for item in density.get("items", []) if item.get("component")}


def primary_metrics(component: dict[str, Any]) -> dict[str, Any]:
    qa = component.get("qa", [])
    if not qa:
        return {}
    return qa[0].get("metrics", {}) or {}


def qa_role(component: dict[str, Any], qa: dict[str, Any]) -> str:
    dxf_files = component.get("dxf_files", [])
    if not dxf_files:
        return "unknown"
    primary = str(dxf_files[0]).replace("\\", "/")
    dxf = str(qa.get("dxf", "")).replace("\\", "/")
    return "production" if dxf == primary else "companion/stress"


def seam_join_targets(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for component in manifest.get("components", []):
        for qa in component.get("qa", []):
            metrics = qa.get("metrics") or {}
            checked = bool(qa.get("seam_tangent_check") or metrics.get("seam_tangent_checked"))
            if not checked:
                continue
            thresholds = qa.get("thresholds") or {}
            max_delta = float(thresholds.get("max_seam_tangent_delta", 45.0) or 45.0)
            max_y_delta = float(thresholds.get("max_start_end_y_delta", 0.001) or 0.001)
            seam_delta = metrics.get("seam_tangent_delta_degrees")
            y_delta = metrics.get("start_end_y_delta")
            endpoint = metrics.get("endpoint_review") or {}
            repeat_warnings = [item for item in qa.get("warnings", []) if "Repeat" in str(item) or "tangent" in str(item)]
            issue = bool(repeat_warnings)
            if isinstance(seam_delta, (int, float)) and seam_delta > max_delta:
                issue = True
            if isinstance(y_delta, (int, float)) and abs(y_delta) > max_y_delta:
                issue = True
            rows.append(
                {
                    "component": component,
                    "qa": qa,
                    "endpoint": endpoint,
                    "seam_delta": seam_delta,
                    "y_delta": y_delta,
                    "repeat_warnings": repeat_warnings,
                    "passes": not issue,
                }
            )
    return rows


def machine_warning_scope_summary(scope: dict[str, Any]) -> str:
    if not scope:
        return '<p class="muted">Machine warning scope was not recorded for this package.</p>'
    production_components = scope.get("production_warning_components") or []
    rows = [
        f"Production targets: {scope.get('production_target_count', 'n/a')}",
        f"Companion/stress targets: {scope.get('companion_or_stress_target_count', 'n/a')}",
        f"Production warnings: {scope.get('production_warning_count', 'n/a')}",
        f"Companion/stress warnings: {scope.get('companion_or_stress_warning_count', 'n/a')}",
        f"Production warning components: {', '.join(production_components) if production_components else 'none'}",
        f"Production reversals/cusps/tiny segments: {scope.get('production_reversal_turn_count', 'n/a')} / {scope.get('production_cusp_turn_count', 'n/a')} / {scope.get('production_tiny_segment_count', 'n/a')}",
        scope.get("review_note", ""),
    ]
    return list_block([row for row in rows if row], "risk-list" if scope.get("production_warning_count") else "good-list")


def component_rows(manifest: dict[str, Any]) -> str:
    densities = density_by_component(manifest)
    rows = []
    for component in manifest.get("components", []):
        density = densities.get(component.get("id"), {})
        qas = component.get("qa", [])
        qa_passes = sum(1 for item in qas if item.get("passes"))
        warnings = sum(len(item.get("warnings", [])) for item in qas)
        failures = sum(len(item.get("failures", [])) for item in qas)
        metrics = primary_metrics(component)
        preview = component.get("preview")
        preview_link = f'<a href="{href(preview)}">preview</a>' if preview else '<span class="muted">none</span>'
        dxf_links = []
        for dxf in component.get("dxf_files", []):
            dxf_links.append(f'<a href="{href(dxf)}">{esc(Path(dxf).name)}</a>')
        rows.append(
            "<tr>"
            f"<td><strong>{esc(component.get('geography'))}</strong><br><span class=\"muted\">{esc(component.get('id'))}</span></td>"
            f"<td>{esc(component.get('density_role'))}</td>"
            f"<td>{joined(component.get('motifs', []))}</td>"
            f"<td>{joined(component.get('omitted_motifs', []))}</td>"
            f"<td>{esc(qa_passes)}/{esc(len(qas))}</td>"
            f"<td>{esc(warnings)} warnings<br>{esc(failures)} failures</td>"
            f"<td>{esc(density.get('density_band', 'n/a'))}<br><span class=\"muted\">ratio {esc(density.get('relative_to_median', 'n/a'))}</span></td>"
            f"<td>{esc(metrics.get('total_drawn_length', 'n/a'))}</td>"
            f"<td>{preview_link}<br>{'<br>'.join(dxf_links)}</td>"
            "</tr>"
        )
    return "\n".join(rows)


def point_label(point: Any) -> str:
    if isinstance(point, list) and len(point) >= 2:
        return f"({point[0]}, {point[1]})"
    return "n/a"


def seam_join_rows(manifest: dict[str, Any]) -> str:
    rows: list[str] = []
    for item in seam_join_targets(manifest):
        component = item["component"]
        qa = item["qa"]
        endpoint = item["endpoint"]
        qa_link = qa.get("qa_json")
        status = "Clean" if item["passes"] else "Review"
        warnings = item["repeat_warnings"]
        rows.append(
            "<tr>"
            f"<td><strong>{esc(component.get('geography'))}</strong><br><span class=\"muted\">{esc(component.get('id'))}</span></td>"
            f"<td>{esc(qa_role(component, qa))}</td>"
            f"<td>{esc(Path(qa.get('dxf', '')).name)}</td>"
            f"<td>{esc(point_label(endpoint.get('start_point')))}<br>{esc(point_label(endpoint.get('end_point')))}</td>"
            f"<td>{esc(item.get('y_delta', 'n/a'))}</td>"
            f"<td>{esc(endpoint.get('start_heading_degrees', 'n/a'))}<br>{esc(endpoint.get('end_heading_degrees', 'n/a'))}</td>"
            f"<td>{esc(item.get('seam_delta', 'n/a'))}</td>"
            f"<td>{esc(status)}<br>{list_block(warnings, 'risk-list') if warnings else '<span class=\"muted\">No repeat-join warnings.</span>'}</td>"
            f"<td>{f'<a href=\"{href(qa_link)}\">QA JSON</a>' if qa_link else '<span class=\"muted\">n/a</span>'}</td>"
            "</tr>"
        )
    if not rows:
        return '<tr><td colspan="9" class="muted">No repeat seam tangent checks were recorded for this package.</td></tr>'
    return "\n".join(rows)


def hotspot_summary(items: list[dict[str, Any]], label: str) -> str:
    if not items:
        return f'<span class="muted">{esc(label)}: none sampled</span>'
    samples = []
    for item in items[:3]:
        if "point" in item:
            samples.append(f"{point_label(item.get('point'))} / {item.get('angle')} deg")
        elif "start" in item:
            samples.append(f"{point_label(item.get('start'))} / {item.get('length')}")
    return f"<strong>{esc(label)}:</strong> {esc('; '.join(samples))}"


def machine_hotspot_rows(manifest: dict[str, Any]) -> str:
    rows: list[str] = []
    for component in manifest.get("components", []):
        for qa in component.get("qa", []):
            warnings = qa.get("warnings", [])
            metrics = qa.get("metrics") or {}
            hotspots = metrics.get("hotspots") or {}
            hotspot_preview = metrics.get("hotspot_preview")
            preview_img = (
                f'<a href="{href(hotspot_preview)}"><img class="hotspot-preview" src="{href(hotspot_preview)}" alt="Machine hotspot overlay"></a>'
                if hotspot_preview
                else '<span class="muted">n/a</span>'
            )
            if not warnings and not any(hotspots.get(key) for key in ("reversals", "cusps", "micro_segments", "tiny_segments")):
                continue
            qa_link = qa.get("qa_json")
            dxf_name = Path(qa.get("dxf", "")).name
            rows.append(
                "<tr>"
                f"<td><strong>{esc(component.get('geography'))}</strong><br><span class=\"muted\">{esc(dxf_name)}</span></td>"
                f"<td>{esc(qa_role(component, qa))}</td>"
                f"<td>{preview_img}</td>"
                f"<td>{esc(metrics.get('reversal_turn_count', 0))}</td>"
                f"<td>{esc(metrics.get('cusp_turn_count', 0))}</td>"
                f"<td>{esc(metrics.get('tiny_segment_count', 0))}</td>"
                f"<td>{hotspot_summary(hotspots.get('reversals', []), 'reversals')}<br>{hotspot_summary(hotspots.get('cusps', []), 'cusps')}<br>{hotspot_summary(hotspots.get('tiny_segments', []), 'tiny segments')}</td>"
                f"<td>{list_block(warnings, 'risk-list')}</td>"
                f"<td>{f'<a href=\"{href(qa_link)}\">QA JSON</a>' if qa_link else '<span class=\"muted\">n/a</span>'}</td>"
                "</tr>"
            )
    if not rows:
        return '<tr><td colspan="9" class="muted">No machine hotspots were recorded.</td></tr>'
    return "\n".join(rows)


def flow_review_rows(manifest: dict[str, Any]) -> str:
    rows: list[str] = []
    for component in manifest.get("components", []):
        for qa in component.get("qa", []):
            metrics = qa.get("metrics") or {}
            endpoint = metrics.get("endpoint_review") or {}
            preview = metrics.get("hotspot_preview")
            overlay = metrics.get("flow_overlay") or {}
            preview_img = (
                f'<a href="{href(preview)}"><img class="flow-preview" src="{href(preview)}" alt="Stitch flow overlay"></a>'
                if preview
                else '<span class="muted">n/a</span>'
            )
            qa_link = qa.get("qa_json")
            dxf_name = Path(qa.get("dxf", "")).name
            rows.append(
                "<tr>"
                f"<td><strong>{esc(component.get('geography'))}</strong><br><span class=\"muted\">{esc(component.get('id'))}</span></td>"
                f"<td>{esc(qa_role(component, qa))}</td>"
                f"<td>{esc(dxf_name)}</td>"
                f"<td>{preview_img}</td>"
                f"<td>{esc(point_label(endpoint.get('start_point')))}<br>{esc(endpoint.get('start_heading_degrees', 'n/a'))} deg</td>"
                f"<td>{esc(point_label(endpoint.get('end_point')))}<br>{esc(endpoint.get('end_heading_degrees', 'n/a'))} deg</td>"
                f"<td>{esc(metrics.get('total_drawn_length', 'n/a'))}</td>"
                f"<td>{esc(overlay.get('version', 'not recorded'))}</td>"
                f"<td>{f'<a href=\"{href(qa_link)}\">QA JSON</a>' if qa_link else '<span class=\"muted\">n/a</span>'}</td>"
                "</tr>"
            )
    if not rows:
        return '<tr><td colspan="9" class="muted">No stitch-flow overlays were recorded.</td></tr>'
    return "\n".join(rows)


def preview_framing_rows(manifest: dict[str, Any], root: Path) -> str:
    rows: list[str] = []
    for component in manifest.get("components", []):
        visual = visual_metrics(root, component.get("preview"))
        if not visual or not visual.get("available"):
            rows.append(
                "<tr>"
                f"<td><strong>{esc(component.get('geography'))}</strong><br><span class=\"muted\">{esc(component.get('id'))}</span></td>"
                f"<td>{esc(component.get('preview'))}</td>"
                '<td colspan="5" class="muted">Preview metrics unavailable.</td>'
                "</tr>"
            )
            continue
        coverage = f"{visual.get('foreground_width_ratio', 'n/a')} / {visual.get('foreground_height_ratio', 'n/a')}"
        center = f"{visual.get('center_x_offset', 'n/a')} / {visual.get('center_y_offset', 'n/a')}"
        margins = (
            f"L {visual.get('margin_left_ratio', 'n/a')}, R {visual.get('margin_right_ratio', 'n/a')}<br>"
            f"T {visual.get('margin_top_ratio', 'n/a')}, B {visual.get('margin_bottom_ratio', 'n/a')}"
        )
        rows.append(
            "<tr>"
            f"<td><strong>{esc(component.get('geography'))}</strong><br><span class=\"muted\">{esc(component.get('id'))}</span></td>"
            f"<td><a href=\"{href(component.get('preview'))}\">{esc(Path(component.get('preview') or '').name)}</a></td>"
            f"<td>{esc(visual.get('ink_pixel_ratio', 'n/a'))}</td>"
            f"<td>{esc(coverage)}</td>"
            f"<td>{esc(center)}</td>"
            f"<td>{margins}</td>"
            f"<td>{esc(visual.get('image_size', 'n/a'))}</td>"
            "</tr>"
        )
    return "\n".join(rows)


def card(label: str, value: Any, css_class: str = "neutral", detail: str | None = None) -> str:
    detail_html = f'<span class="card-detail">{esc(detail)}</span>' if detail else ""
    return (
        f'<section class="card {esc(css_class)}">'
        f'<span class="card-label">{esc(label)}</span>'
        f'<strong>{esc(value)}</strong>'
        f"{detail_html}</section>"
    )


def regression_summary(payload: dict[str, Any] | None, manifest: dict[str, Any]) -> str:
    if not payload:
        comparison = manifest.get("regression_comparison") or {}
        if not comparison:
            return '<p class="muted">No baseline comparison was recorded.</p>'
        return f'<p>Comparison result: <strong>{esc(comparison.get("winner", "recorded"))}</strong>.</p>'

    delta = payload.get("art_critique_delta") or {}
    score_delta = delta.get("score_delta")
    warning_delta = delta.get("warning_count_delta")
    machine_delta = payload.get("machine_qa_delta") or {}
    production_warning_delta = machine_delta.get("production_warning_delta")
    companion_warning_delta = machine_delta.get("companion_or_stress_warning_delta")
    details = [
        f"Winner: {payload.get('winner', 'unknown')}",
        f"Regressions: {len(payload.get('regressions', []))}",
        f"Improvements: {len(payload.get('improvements', []))}",
    ]
    if score_delta is not None:
        details.append(f"Art score delta: {score_delta}")
    if warning_delta is not None:
        details.append(f"Art warning delta: {warning_delta}")
    if production_warning_delta is not None:
        details.append(f"Production QA warning delta: {production_warning_delta}")
    if companion_warning_delta is not None:
        details.append(f"Companion/stress QA warning delta: {companion_warning_delta}")

    html_parts = [f"<p>{esc(' | '.join(details))}</p>"]
    regressions = payload.get("regressions", [])
    improvements = payload.get("improvements", [])
    if regressions:
        html_parts.append("<h3>Regressions</h3>")
        html_parts.append(list_block(regressions, "risk-list"))
    if improvements:
        html_parts.append("<h3>Improvements</h3>")
        html_parts.append(list_block(improvements, "good-list"))
    return "\n".join(html_parts)


def render(manifest: dict[str, Any], root: Path, critique: dict[str, Any] | None, regression: dict[str, Any] | None) -> str:
    components = manifest.get("components", [])
    qa = qa_totals(components)
    contact_sheet = manifest.get("contact_sheet")
    contact_layout = manifest.get("contact_sheet_layout") or {}
    dxf_package = manifest.get("dxf_package")
    density = manifest.get("density_summary") or {}
    critique_score = None
    critique_warnings: list[Any] = []
    critique_failures: list[Any] = []
    critique_strengths: list[Any] = []
    critique_payload: dict[str, Any] | None = None
    if critique:
        critique_payload = critique
        critique_score = critique.get("score")
        critique_warnings = critique.get("warnings", [])
        critique_failures = critique.get("failures", [])
        critique_strengths = critique.get("strengths", [])
    elif isinstance(manifest.get("art_critique"), dict):
        critique_payload = manifest["art_critique"]
        critique_score = manifest["art_critique"].get("score")
        critique_warnings = manifest["art_critique"].get("warnings", [])
        critique_failures = manifest["art_critique"].get("failures", [])
        critique_strengths = manifest["art_critique"].get("strengths", [])
    machine_scope = ((critique_payload or {}).get("metrics") or {}).get("machine_warning_scope") or {}
    production_warning_count = machine_scope.get("production_warning_count")
    production_card_detail = (
        f"{production_warning_count} primary warnings; "
        f"{machine_scope.get('companion_or_stress_warning_count', 'n/a')} companion/stress warnings"
        if machine_scope
        else "scope not recorded"
    )
    production_card_value = f"{production_warning_count} warnings" if machine_scope else "n/a"
    production_card_class = "warn" if production_warning_count else ("pass" if machine_scope else "neutral")
    seam_targets = seam_join_targets(manifest)
    seam_clean = sum(1 for item in seam_targets if item.get("passes"))
    seam_flagged = len(seam_targets) - seam_clean
    seam_card_value = f"{seam_clean}/{len(seam_targets)} clean" if seam_targets else "n/a"
    seam_card_class = "warn" if seam_flagged else ("pass" if seam_targets else "neutral")
    seam_card_detail = "repeatable border/sashing/row joins" if seam_targets else "not recorded"
    flow_overlay_count = sum(
        1
        for component in components
        for qa_item in component.get("qa", [])
        if ((qa_item.get("metrics") or {}).get("flow_overlay") or {}).get("version")
    )
    flow_card_class = "pass" if flow_overlay_count == qa["targets"] and qa["targets"] else ("warn" if qa["targets"] else "neutral")

    contact = ""
    if contact_sheet and (root / contact_sheet).exists():
        contact = f'<img class="contact-sheet" src="{href(contact_sheet)}" alt="Native coordinate set contact sheet">'
    else:
        contact = '<p class="muted">No contact sheet image found.</p>'
    contact_layout_note = ""
    if contact_layout:
        strip_bands = ", ".join(contact_layout.get("strip_band_order", [])) or "none"
        contact_layout_note = (
            f'<p class="muted">Contact sheet layout: {esc(contact_layout.get("mode", "recorded"))}. '
            f'Strip bands: {esc(strip_bands)}. {esc(contact_layout.get("review_note", ""))}</p>'
        )

    cards = "\n".join(
        [
            card("Component Builds", yes_no(manifest.get("component_builds_passed")), status_class(manifest.get("component_builds_passed"))),
            card("Strict Machine QA", yes_no(manifest.get("strict_machine_qa_passed")), status_class(manifest.get("strict_machine_qa_passed")), f"{qa['passed']}/{qa['targets']} targets"),
            card("Art Critique", yes_no(manifest.get("art_critique_passed")), status_class(manifest.get("art_critique_passed")), f"score {critique_score if critique_score is not None else 'n/a'}"),
            card("Regression", yes_no(manifest.get("regression_comparison_passed")), status_class(manifest.get("regression_comparison_passed")), (manifest.get("regression_comparison") or {}).get("winner")),
            card("QA Warnings", qa["warnings"], "warn" if qa["warnings"] else "pass", f"{qa['failures']} failures"),
            card("Production QA", production_card_value, production_card_class, production_card_detail),
            card("Seam Joins", seam_card_value, seam_card_class, seam_card_detail),
            card("Flow Maps", f"{flow_overlay_count}/{qa['targets']}", flow_card_class, "start, end, and direction overlays"),
            card("Density Review", yes_no(density.get("role_aware_balance_passed")), status_class(density.get("role_aware_balance_passed")), f"spread {density.get('density_proxy_spread', 'n/a')}"),
        ]
    )

    dxf_link = f'<a class="button" href="{href(dxf_package)}">Open DXF Package</a>' if dxf_package else ""
    manifest_link = '<a class="button secondary" href="native-sakura-coordinate-set-manifest.json">Open Manifest</a>'

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{esc(manifest.get("name", "Native Coordinate Package"))} Review</title>
  <style>
    :root {{
      color-scheme: light;
      --ink: #17313a;
      --line: #d7d1c7;
      --muted: #69787e;
      --paper: #f7f6f1;
      --panel: #ffffff;
      --blue: #0b5d80;
      --green: #27614d;
      --amber: #8a5d10;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font: 14px/1.55 "Segoe UI", Arial, sans-serif;
    }}
    header, main {{
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px;
    }}
    header {{
      padding-top: 32px;
      padding-bottom: 12px;
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: 30px;
      line-height: 1.15;
      letter-spacing: 0;
    }}
    h2 {{
      margin: 28px 0 10px;
      font-size: 20px;
      letter-spacing: 0;
    }}
    h3 {{
      margin: 16px 0 6px;
      font-size: 15px;
      letter-spacing: 0;
    }}
    a {{ color: var(--blue); }}
    .subtitle {{ max-width: 880px; color: var(--muted); margin: 0; }}
    .button-row {{ display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }}
    .button {{
      display: inline-block;
      color: white;
      background: var(--blue);
      text-decoration: none;
      border-radius: 6px;
      padding: 8px 12px;
      font-weight: 650;
    }}
    .button.secondary {{
      color: var(--ink);
      background: #e9e5dc;
    }}
    .cards {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin: 18px 0 20px;
    }}
    .card {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-left: 5px solid #a9b4b8;
      border-radius: 7px;
      padding: 12px;
      min-height: 88px;
    }}
    .card.pass {{ border-left-color: var(--green); }}
    .card.warn {{ border-left-color: var(--amber); }}
    .card-label {{
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }}
    .card strong {{ display: block; font-size: 20px; }}
    .card-detail {{ display: block; color: var(--muted); margin-top: 2px; }}
    .panel {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 16px;
      margin: 16px 0;
    }}
    .contact-sheet {{
      display: block;
      width: 100%;
      max-width: 1180px;
      height: auto;
      border: 1px solid var(--line);
      background: white;
    }}
    .hotspot-preview {{
      display: block;
      width: 180px;
      max-width: 100%;
      height: auto;
      border: 1px solid var(--line);
      background: white;
    }}
    .flow-preview {{
      display: block;
      width: 220px;
      max-width: 100%;
      height: auto;
      border: 1px solid var(--line);
      background: white;
    }}
    .muted {{ color: var(--muted); }}
    .split {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }}
    ul {{ margin: 8px 0 0; padding-left: 22px; }}
    li {{ margin: 4px 0; }}
    .risk-list li {{ color: #703f00; }}
    .good-list li {{ color: #245842; }}
    table {{
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 7px;
      overflow: hidden;
    }}
    th, td {{
      vertical-align: top;
      text-align: left;
      border-bottom: 1px solid var(--line);
      padding: 10px;
    }}
    th {{
      background: #ece8df;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }}
    tr:last-child td {{ border-bottom: 0; }}
    footer {{
      max-width: 1280px;
      margin: 0 auto;
      padding: 8px 24px 36px;
      color: var(--muted);
    }}
  </style>
</head>
<body>
  <header>
    <h1>{esc(manifest.get("name", "Native Coordinate Package"))}</h1>
    <p class="subtitle">{esc(manifest.get("art_status"))}. {esc(manifest.get("machine_status"))}. This report is a review aid for continuous-line computerized longarm DXF work; it does not replace stitch testing or final art approval.</p>
    <div class="button-row">{dxf_link}{manifest_link}</div>
  </header>
  <main>
    <section class="cards">
      {cards}
    </section>

    <h2>Contact Sheet</h2>
    {contact}
    {contact_layout_note}

    <section class="split">
      <div class="panel">
        <h2>Art Critique</h2>
        <h3>Warnings</h3>
        {list_block(critique_warnings, "risk-list")}
        <h3>Failures</h3>
        {list_block(critique_failures, "risk-list")}
      </div>
      <div class="panel">
        <h2>Strengths</h2>
        {list_block(critique_strengths, "good-list")}
      </div>
    </section>

    <section class="panel">
      <h2>Machine Warning Scope</h2>
      {machine_warning_scope_summary(machine_scope)}
    </section>

    <section class="panel">
      <h2>Seam / Repeat Joins</h2>
      <p class="muted">Repeatable pieces are checked for same-plane endpoints and compatible start/end tangents so chained computerized-longarm repeats do not develop a visible hitch.</p>
      <table>
        <thead>
          <tr>
            <th>Geography</th>
            <th>Role</th>
            <th>DXF</th>
            <th>Start / End</th>
            <th>Y Delta</th>
            <th>Heading Start / End</th>
            <th>Tangent Delta</th>
            <th>Status</th>
            <th>QA File</th>
          </tr>
        </thead>
        <tbody>
          {seam_join_rows(manifest)}
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Stitch Flow</h2>
      <p class="muted">Every QA overlay marks the ordered stitch path with start, end, and directional arrows so continuous-line travel can be reviewed visually.</p>
      <table>
        <thead>
          <tr>
            <th>Geography</th>
            <th>Role</th>
            <th>DXF</th>
            <th>Flow Map</th>
            <th>Start</th>
            <th>End</th>
            <th>Drawn Length</th>
            <th>Overlay</th>
            <th>QA File</th>
          </tr>
        </thead>
        <tbody>
          {flow_review_rows(manifest)}
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Regression Comparison</h2>
      {regression_summary(regression, manifest)}
    </section>

    <section class="panel">
      <h2>Density Review</h2>
      <p>{esc(density.get("method", ""))}</p>
      {list_block(density.get("review_flags", []), "risk-list")}
    </section>

    <h2>Preview Framing</h2>
    <table>
      <thead>
        <tr>
          <th>Geography</th>
          <th>Preview</th>
          <th>Ink Ratio</th>
          <th>Coverage W/H</th>
          <th>Center Offset X/Y</th>
          <th>Margins</th>
          <th>Image Size</th>
        </tr>
      </thead>
      <tbody>
        {preview_framing_rows(manifest, root)}
      </tbody>
    </table>

    <h2>Machine Hotspots</h2>
    <table>
      <thead>
        <tr>
          <th>Geography</th>
          <th>Role</th>
          <th>Map</th>
          <th>Reversals</th>
          <th>Cusps</th>
          <th>Tiny Segments</th>
          <th>Sample Coordinates</th>
          <th>Warnings</th>
          <th>QA File</th>
        </tr>
      </thead>
      <tbody>
        {machine_hotspot_rows(manifest)}
      </tbody>
    </table>

    <h2>Component Review</h2>
    <table>
      <thead>
        <tr>
          <th>Geography</th>
          <th>Role</th>
          <th>Motifs Used</th>
          <th>Motifs Omitted</th>
          <th>QA</th>
          <th>Risk Count</th>
          <th>Density</th>
          <th>Drawn Length</th>
          <th>Files</th>
        </tr>
      </thead>
      <tbody>
        {component_rows(manifest)}
      </tbody>
    </table>
  </main>
  <footer>
    Generated from the native package manifest.
  </footer>
</body>
</html>
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", help="Native coordinate package directory or manifest JSON.")
    parser.add_argument("--out", help="Output HTML path. Defaults to native-package-review-report.html beside the manifest.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest_path = find_manifest(Path(args.package))
    root = package_root(manifest_path)
    manifest = load_json(manifest_path)
    critique = optional_payload(root, manifest.get("art_critique"))
    regression = optional_payload(root, manifest.get("regression_comparison"))
    out_path = Path(args.out) if args.out else root / "native-package-review-report.html"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(render(manifest, root, critique, regression), encoding="utf-8")
    print(json.dumps({"report": str(out_path), "manifest": str(manifest_path)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
