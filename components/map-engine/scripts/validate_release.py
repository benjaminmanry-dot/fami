#!/usr/bin/env python3
"""Validate one 20Fates exact-hash release manifest without dependencies."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


SHA256_RE = re.compile(r"^[0-9A-Fa-f]{64}$")
STATUSES = {"candidate", "accepted", "rejected", "superseded", "benchmark-only"}
REVIEW_ADMISSION_STATUSES = {"candidate", "accepted"}
RELATIONS = {"connects", "supports", "repairs", "controls", "contains", "marks"}
PHYSICAL_RELATIONS = {"connects", "supports", "repairs"}
CHECK_NAMES = ("tactical", "lineage", "native_scale", "cold_authorship", "beauty")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def read_json(path: Path, errors: list[str], label: str) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        errors.append(f"{label}: cannot read valid JSON: {exc}")
        return None
    if not isinstance(data, dict):
        errors.append(f"{label}: top level must be an object")
        return None
    return data


def contained_path(root: Path, relative: Any, errors: list[str], label: str) -> Path | None:
    if not isinstance(relative, str) or not relative:
        errors.append(f"{label}: path must be a non-empty string")
        return None
    candidate_text = Path(relative)
    if candidate_text.is_absolute():
        errors.append(f"{label}: local path must be relative to manifest root")
        return None
    candidate = (root / candidate_text).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        errors.append(f"{label}: path escapes manifest root")
        return None
    return candidate


def verify_record(
    record: Any,
    root: Path,
    errors: list[str],
    label: str,
    *,
    external_allowed: bool = False,
) -> Path | None:
    if not isinstance(record, dict):
        errors.append(f"{label}: record must be an object")
        return None
    expected = record.get("sha256")
    if not isinstance(expected, str) or not SHA256_RE.fullmatch(expected):
        errors.append(f"{label}: sha256 must be exactly 64 hexadecimal characters")
        return None
    if record.get("external", False):
        raw_path = record.get("path")
        if not external_allowed:
            errors.append(f"{label}: external paths are not allowed here")
            return None
        if not isinstance(raw_path, str) or not Path(raw_path).is_absolute():
            errors.append(f"{label}: external path must be absolute")
            return None
        path = Path(raw_path).resolve()
    else:
        path = contained_path(root, record.get("path"), errors, label)
        if path is None:
            return None
    if not path.is_file():
        errors.append(f"{label}: file does not exist: {path}")
        return None
    actual = file_sha256(path)
    if actual != expected.upper():
        errors.append(f"{label}: hash mismatch (expected {expected.upper()}, found {actual})")
    return path


def validate_brief(path: Path | None, errors: list[str]) -> None:
    if path is None:
        return
    brief = read_json(path, errors, "brief")
    if brief is None:
        return
    if brief.get("brief_version") != "1.0":
        errors.append("brief: brief_version must be 1.0")
    if brief.get("status") != "frozen":
        errors.append("brief: status must be frozen")
    if not isinstance(brief.get("provenance"), list) or not brief["provenance"]:
        errors.append("brief: provenance must contain at least one source")
    if (brief.get("structure_gate") or {}).get("status") != "passed":
        errors.append("brief: Story Engine structure gate must be passed")
    handoff = brief.get("handoff") or {}
    if handoff.get("timing") != "after Story Engine structure gate":
        errors.append("brief: handoff timing must remain after Story Engine structure gate")
    if handoff.get("ben_gates_preserved") != 2:
        errors.append("brief: exactly two Story Engine Ben gates must be preserved")


def validate_asset_audit(path: Path | None, errors: list[str]) -> dict[str, Any] | None:
    if path is None:
        return None
    audit = read_json(path, errors, "asset sufficiency audit")
    if audit is None:
        return None
    if audit.get("status") != "pass":
        errors.append("asset sufficiency audit: status must be pass before graph freeze")
    if not audit.get("scene_owner") or audit.get("scene_owner_accepts_final_construction") is not True:
        errors.append("asset sufficiency audit: a scene owner must accept final construction responsibility")
    if not isinstance(audit.get("assemblies_in_scope"), list) or not audit["assemblies_in_scope"]:
        errors.append("asset sufficiency audit: assemblies_in_scope must be a non-empty array")
    if not isinstance(audit.get("assets"), list) or not audit["assets"]:
        errors.append("asset sufficiency audit: assets must be a non-empty array")
    gaps = audit.get("unresolved_gaps")
    if not isinstance(gaps, list) or gaps:
        errors.append("asset sufficiency audit: unresolved gaps must be an empty array")
    lane = audit.get("asset_production_lane")
    if not isinstance(lane, dict) or lane.get("status") not in {"not-required", "completed"}:
        errors.append("asset sufficiency audit: asset-production lane must be not-required or completed")
    elif lane.get("status") == "completed":
        deliverables = lane.get("deliverables")
        if not isinstance(deliverables, list) or not deliverables or any(
            not isinstance(item, dict) or item.get("status") != "admitted" for item in deliverables
        ):
            errors.append("asset sufficiency audit: every completed-lane deliverable must be admitted")
    return audit


def validate_graph(path: Path | None, root: Path, errors: list[str], *, strict_v13: bool) -> dict[str, Any] | None:
    if path is None:
        return None
    graph = read_json(path, errors, "construction graph")
    if graph is None:
        return None
    expected_graph_version = "1.3" if strict_v13 else "1.2"
    if graph.get("graph_version") != expected_graph_version:
        errors.append(f"construction graph: graph_version must be {expected_graph_version}")
    if graph.get("status") != "frozen":
        errors.append("construction graph: status must be frozen")

    sufficiency = graph.get("asset_sufficiency")
    if not isinstance(sufficiency, dict):
        errors.append("construction graph: asset sufficiency record is required")
    else:
        if sufficiency.get("status") != "pass" or sufficiency.get("unresolved_gaps") != 0:
            errors.append("construction graph: asset sufficiency has unresolved gaps")
        if sufficiency.get("asset_production_lane_status") not in {"not-required", "completed"}:
            errors.append("construction graph: unresolved asset-production request blocks freeze")
        audit_path = verify_record(
            {"path": sufficiency.get("audit_path"), "sha256": sufficiency.get("audit_sha256")},
            root,
            errors,
            "asset sufficiency audit record",
        )
        audit = validate_asset_audit(audit_path, errors)
    if not isinstance(sufficiency, dict):
        audit = None

    blockout = graph.get("blockout_review")
    if not isinstance(blockout, dict):
        errors.append("construction graph: blockout review record is required")
    else:
        if blockout.get("status") != "pass":
            errors.append("construction graph: blockout review must pass before finish")
        if blockout.get("reviewer_context") != "fresh-unprimed":
            errors.append("construction graph: blockout reviewer must be fresh and unprimed")
        if blockout.get("supplied_context") != ["unlabeled construction blockout", "grid scale only"]:
            errors.append("construction graph: blockout review may receive only the unlabeled blockout and grid scale")
        corrections = blockout.get("corrections_used")
        if not isinstance(corrections, int) or isinstance(corrections, bool) or corrections < 0:
            errors.append("construction graph: blockout corrections_used must be a non-negative integer")
        verify_record(
            {"path": blockout.get("artifact_path"), "sha256": blockout.get("artifact_sha256")},
            root,
            errors,
            "construction blockout record",
        )
        report_path = verify_record(
            {"path": blockout.get("report_path"), "sha256": blockout.get("report_sha256")},
            root,
            errors,
            "construction blockout review record",
        )
        report = read_json(report_path, errors, "construction blockout review") if report_path else None
        if report is not None and report.get("status") != "pass":
            errors.append("construction blockout review: immutable report status must be pass")

    aesthetic = graph.get("aesthetic_contract")
    if not isinstance(aesthetic, dict):
        errors.append("construction graph: aesthetic contract is required")
    else:
        for field in ("emotional_thesis", "palette_value_opposition", "physical_medium", "asymmetry_rhythm", "state_transformation"):
            if not isinstance(aesthetic.get(field), str) or not aesthetic[field]:
                errors.append(f"construction graph: aesthetic contract needs {field}")
        hierarchy = aesthetic.get("hierarchy")
        if not isinstance(hierarchy, dict) or not isinstance(hierarchy.get("hero"), str) or not hierarchy.get("hero"):
            errors.append("construction graph: aesthetic hierarchy needs one hero")
        elif not isinstance(hierarchy.get("supports"), list) or not hierarchy["supports"] or not isinstance(hierarchy.get("quiet_areas"), list) or not hierarchy["quiet_areas"]:
            errors.append("construction graph: aesthetic hierarchy needs supports and quiet areas")
        for field in ("mark_language", "causal_relationships"):
            values = aesthetic.get(field)
            if not isinstance(values, list) or not values or not all(isinstance(value, str) and value for value in values):
                errors.append(f"construction graph: aesthetic contract needs {field}")
        anchors = aesthetic.get("accepted_visual_anchors")
        if not isinstance(anchors, list) or not anchors:
            errors.append("construction graph: aesthetic contract needs exact accepted visual anchors")
        else:
            for index, anchor in enumerate(anchors):
                verify_record(anchor, root, errors, f"accepted visual anchor {index}")
                if not isinstance(anchor, dict) or not isinstance(anchor.get("role"), str) or not anchor["role"]:
                    errors.append(f"accepted visual anchor {index}: role is required")

    beauty = graph.get("beauty_proof_review")
    if not isinstance(beauty, dict):
        errors.append("construction graph: beauty proof review record is required")
    else:
        if beauty.get("status") != "pass":
            errors.append("construction graph: beauty proof review must pass before finish")
        if beauty.get("finish_authorized") is not True:
            errors.append("construction graph: finish requires explicit beauty authorization")
        if beauty.get("reviewer_context") != "fresh-unprimed-aesthetic":
            errors.append("construction graph: beauty reviewer must be fresh and unprimed")
        if beauty.get("supplied_context") != ["unlabeled color/value/composition proof", "equal-scale exact accepted visual anchors"]:
            errors.append("construction graph: beauty review may receive only the unlabeled proof and equal-scale exact accepted anchors")
        corrections = beauty.get("corrections_used")
        if not isinstance(corrections, int) or isinstance(corrections, bool) or corrections < 0:
            errors.append("construction graph: beauty corrections_used must be a non-negative integer")
        verify_record(
            {"path": beauty.get("proof_path"), "sha256": beauty.get("proof_sha256")},
            root,
            errors,
            "beauty proof record",
        )
        report_path = verify_record(
            {"path": beauty.get("report_path"), "sha256": beauty.get("report_sha256")},
            root,
            errors,
            "beauty proof review record",
        )
        report = read_json(report_path, errors, "beauty proof review") if report_path else None
        if report is not None and report.get("status") != "pass":
            errors.append("beauty proof review: immutable report status must be pass")

    assets = graph.get("assets")
    if not isinstance(assets, list) or not assets:
        errors.append("construction graph: assets must be a non-empty array")
        assets = []
    asset_by_id: dict[str, dict[str, Any]] = {}
    socket_by_ref: dict[str, dict[str, Any]] = {}
    audit_assets = {
        item.get("id"): item
        for item in (audit or {}).get("assets", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    if strict_v13 and (audit or {}).get("audit_version") != "1.1":
        errors.append("construction graph: v1.3 requires an asset audit_version 1.1")
    for index, asset in enumerate(assets):
        label = f"construction graph: asset {index}"
        if not isinstance(asset, dict) or not isinstance(asset.get("id"), str) or not asset["id"]:
            errors.append(f"{label} needs a non-empty id")
            continue
        asset_id = asset["id"]
        if asset_id in asset_by_id:
            errors.append(f"construction graph: duplicate asset id {asset_id}")
        asset_by_id[asset_id] = asset
        if not isinstance(asset.get("path"), str) or not asset["path"]:
            errors.append(f"construction graph: asset {asset_id} needs a path")
        if not SHA256_RE.fullmatch(str(asset.get("sha256", ""))):
            errors.append(f"construction graph: asset {asset_id} needs an exact sha256")
        if strict_v13:
            verify_record(asset, root, errors, f"construction graph: asset {asset_id} source")
            audit_asset_id = asset.get("audit_asset_id")
            audit_asset = audit_assets.get(audit_asset_id)
            if not isinstance(audit_asset_id, str) or not isinstance(audit_asset, dict):
                errors.append(f"construction graph: asset {asset_id} needs an admitted audit_asset_id")
            elif (
                audit_asset.get("admission") != "admitted"
                or audit_asset.get("path") != asset.get("path")
                or str(audit_asset.get("sha256", "")).upper() != str(asset.get("sha256", "")).upper()
                or audit_asset.get("construction_class") != asset.get("construction_class")
            ):
                errors.append(f"construction graph: asset {asset_id} does not match its admitted audit record")
        construction_class = asset.get("construction_class")
        if construction_class not in {"terrain", "connectable_architecture", "transition", "standalone_prop"}:
            errors.append(f"construction graph: asset {asset_id} has invalid construction_class")
        if not isinstance(asset.get("projection"), str) or not asset["projection"]:
            errors.append(f"construction graph: asset {asset_id} needs a projection")
        if asset.get("alpha_model") not in {"opaque", "transparent", "partial"}:
            errors.append(f"construction graph: asset {asset_id} has invalid alpha_model")
        base_model = asset.get("base_model")
        if base_model not in {"none", "integrated_terrain", "self_contained", "plinth", "enclosing_silhouette"}:
            errors.append(f"construction graph: asset {asset_id} has invalid base_model")
        shadow_model = asset.get("shadow_model")
        if shadow_model not in {"none", "shadowless", "live_shared", "integrated_shared", "baked_ambient", "baked_directional"}:
            errors.append(f"construction graph: asset {asset_id} has invalid shadow_model")
        if construction_class in {"connectable_architecture", "transition"}:
            if base_model in {"self_contained", "plinth", "enclosing_silhouette"}:
                errors.append(f"construction graph: connectable asset {asset_id} has a standalone finished base")
            if shadow_model == "baked_directional":
                errors.append(f"construction graph: connectable asset {asset_id} has a baked directional shadow")
        operations = asset.get("allowed_operations")
        if not isinstance(operations, list) or not operations or not all(isinstance(item, str) and item for item in operations):
            errors.append(f"construction graph: asset {asset_id} needs allowed_operations")
        scale = asset.get("scale_range")
        minimum = scale.get("minimum") if isinstance(scale, dict) else None
        maximum = scale.get("maximum") if isinstance(scale, dict) else None
        if not isinstance(minimum, (int, float)) or isinstance(minimum, bool) or not isinstance(maximum, (int, float)) or isinstance(maximum, bool) or minimum <= 0 or maximum < minimum:
            errors.append(f"construction graph: asset {asset_id} has an invalid scale_range")
        if not isinstance(asset.get("occlusion_profile"), str) or not asset["occlusion_profile"]:
            errors.append(f"construction graph: asset {asset_id} needs an occlusion_profile")
        sockets = asset.get("sockets")
        if not isinstance(sockets, list):
            errors.append(f"construction graph: asset {asset_id} sockets must be an array")
            continue
        seen_socket_ids: set[str] = set()
        for socket_index, socket in enumerate(sockets):
            if not isinstance(socket, dict) or not isinstance(socket.get("id"), str) or not socket["id"]:
                errors.append(f"construction graph: asset {asset_id} socket {socket_index} needs an id")
                continue
            socket_id = socket["id"]
            if socket_id in seen_socket_ids:
                errors.append(f"construction graph: asset {asset_id} has duplicate socket {socket_id}")
            seen_socket_ids.add(socket_id)
            socket_ref = f"{asset_id}.{socket_id}"
            socket_by_ref[socket_ref] = socket
            for field in ("plane", "elevation", "material"):
                if not isinstance(socket.get(field), str) or not socket[field]:
                    errors.append(f"construction graph: socket {socket_ref} needs {field}")
            mates = socket.get("mates")
            if not isinstance(mates, list) or not all(isinstance(item, str) and item for item in mates):
                errors.append(f"construction graph: socket {socket_ref} mates must be an array of socket references")

    assemblies = graph.get("assemblies")
    if not isinstance(assemblies, list) or not assemblies:
        errors.append("construction graph: assemblies must be a non-empty array")
        assemblies = []
    assembly_ids: set[str] = set()
    join_ids: set[str] = set()
    socket_use_count: dict[str, int] = {}
    for index, assembly in enumerate(assemblies):
        if not isinstance(assembly, dict) or not isinstance(assembly.get("id"), str) or not assembly["id"]:
            errors.append(f"construction graph: assembly {index} needs a non-empty id")
            continue
        assembly_id = assembly["id"]
        if assembly_id in assembly_ids:
            errors.append(f"construction graph: duplicate assembly id {assembly_id}")
        assembly_ids.add(assembly_id)
        components = assembly.get("components")
        if not isinstance(components, list) or len(components) < 2:
            errors.append(f"construction graph: assembly {assembly_id} needs at least two components")
            components = []
        for component in components:
            if component not in asset_by_id:
                errors.append(f"construction graph: assembly {assembly_id} references unknown asset {component}")
        joins = assembly.get("joins")
        if not isinstance(joins, list) or not joins:
            errors.append(f"construction graph: assembly {assembly_id} needs at least one owned join")
            joins = []
        for join_index, join in enumerate(joins):
            if not isinstance(join, dict) or not isinstance(join.get("id"), str) or not join["id"]:
                errors.append(f"construction graph: assembly {assembly_id} join {join_index} needs an id")
                continue
            join_id = join["id"]
            if join_id in join_ids:
                errors.append(f"construction graph: duplicate join id {join_id}")
            join_ids.add(join_id)
            endpoints: list[tuple[str | None, str | None, str]] = []
            for side in ("from", "to"):
                endpoint = join.get(side)
                asset_id = endpoint.get("asset_id") if isinstance(endpoint, dict) else None
                socket_id = endpoint.get("socket_id") if isinstance(endpoint, dict) else None
                socket_ref = f"{asset_id}.{socket_id}"
                endpoints.append((asset_id, socket_id, socket_ref))
                if asset_id not in components:
                    errors.append(f"construction graph: join {join_id} {side} asset must be an assembly component")
                if socket_ref not in socket_by_ref:
                    errors.append(f"construction graph: join {join_id} {side} references unknown socket {socket_ref}")
                else:
                    socket_use_count[socket_ref] = socket_use_count.get(socket_ref, 0) + 1
                asset = asset_by_id.get(str(asset_id))
                if asset and asset.get("construction_class") == "standalone_prop":
                    errors.append(f"construction graph: standalone prop {asset_id} cannot participate in architectural join {join_id}")
            from_ref, to_ref = endpoints[0][2], endpoints[1][2]
            for socket_ref, mate_ref in ((from_ref, to_ref), (to_ref, from_ref)):
                socket = socket_by_ref.get(socket_ref)
                if socket is not None and mate_ref not in socket.get("mates", []):
                    errors.append(f"construction graph: join {join_id} uses sockets not declared as mates")
            if join.get("joint_owner") not in components:
                errors.append(f"construction graph: join {join_id} joint_owner must be a component asset")
            for field in ("plane", "elevation", "material", "seam", "occlusion"):
                if not isinstance(join.get(field), str) or not join[field]:
                    errors.append(f"construction graph: join {join_id} needs {field}")
            for _, _, socket_ref in endpoints:
                socket = socket_by_ref.get(socket_ref)
                if socket:
                    for field in ("plane", "elevation", "material"):
                        if join.get(field) != socket.get(field):
                            errors.append(f"construction graph: join {join_id} {field} conflicts with socket {socket_ref}")

    for socket_ref, socket in socket_by_ref.items():
        used = socket_use_count.get(socket_ref, 0)
        if socket.get("required_for_freeze") is True and used == 0:
            errors.append(f"construction graph: required socket {socket_ref} is unmatched")
        if used > 1:
            errors.append(f"construction graph: socket {socket_ref} is used by more than one join")

    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not nodes:
        errors.append("construction graph: nodes must be a non-empty array")
        return graph
    if not isinstance(edges, list) or not edges:
        errors.append("construction graph: edges must be a non-empty array")
        return graph
    node_ids: set[str] = set()
    node_by_id: dict[str, dict[str, Any]] = {}
    for index, node in enumerate(nodes):
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node["id"]:
            errors.append(f"construction graph: node {index} needs a non-empty id")
            continue
        node_id = node["id"]
        if node_id in node_ids:
            errors.append(f"construction graph: duplicate node id {node_id}")
        node_ids.add(node_id)
        node_by_id[node_id] = node
        source = node.get("source")
        if not isinstance(source, dict) or source.get("mode") not in {"asset", "assembly", "authored_terrain"}:
            errors.append(f"construction graph: node {node_id} lacks an admitted source mode")
            continue
        if node.get("nameable") and source.get("mode") not in {"asset", "assembly"}:
            errors.append(f"construction graph: nameable node {node_id} must be an asset or assembly")
        if source.get("mode") == "asset" and source.get("asset_id") not in asset_by_id:
            errors.append(f"construction graph: asset node {node_id} must reference an admitted asset_id")
        if source.get("mode") == "assembly" and source.get("assembly_id") not in assembly_ids:
            errors.append(f"construction graph: assembly node {node_id} must reference an admitted assembly_id")
    incident: set[str] = set()
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            errors.append(f"construction graph: edge {index} must be an object")
            continue
        source_id, target_id = edge.get("from"), edge.get("to")
        if source_id not in node_ids or target_id not in node_ids:
            errors.append(f"construction graph: edge {index} references an unknown node")
        else:
            incident.update((source_id, target_id))
        if edge.get("relation") not in RELATIONS:
            errors.append(f"construction graph: edge {index} has an invalid relation")
        if not edge.get("visible_evidence"):
            errors.append(f"construction graph: edge {index} needs visible_evidence")
        physical = edge.get("physical")
        edge_join_ids = edge.get("join_ids")
        if edge.get("relation") in PHYSICAL_RELATIONS and physical is not True:
            errors.append(f"construction graph: physical relation on edge {index} must be declared physical")
        if physical is True:
            if not isinstance(edge_join_ids, list) or not edge_join_ids:
                errors.append(f"construction graph: physical edge {index} needs join_ids")
            else:
                for join_id in edge_join_ids:
                    if join_id not in join_ids:
                        errors.append(f"construction graph: physical edge {index} references unknown join {join_id}")
        elif edge_join_ids not in ([], None):
            errors.append(f"construction graph: non-physical edge {index} cannot claim join_ids")
    for node_id, node in node_by_id.items():
        if (node.get("importance") in {"primary", "secondary"} or node.get("nameable")) and node_id not in incident:
            errors.append(f"construction graph: major/nameable node {node_id} has no relationship edge")
    composition = graph.get("composition")
    if not isinstance(composition, dict):
        errors.append("construction graph: composition record is required")
        return graph
    if composition.get("primary_subject") not in node_ids:
        errors.append("construction graph: primary_subject must reference a node")
    for node_id in composition.get("supporting_masses", []):
        if node_id not in node_ids:
            errors.append(f"construction graph: supporting mass {node_id} is not a node")
    if not composition.get("quiet_areas"):
        errors.append("construction graph: at least one quiet area is required")
    return graph


def validate_v13_graph_lineage(graph: dict[str, Any] | None, lineage_inputs: list[Any], errors: list[str]) -> None:
    if graph is None:
        return
    lineage_by_identity = {
        (record.get("path"), str(record.get("sha256", "")).upper()): record
        for record in lineage_inputs
        if isinstance(record, dict)
    }
    for asset in graph.get("assets", []):
        if not isinstance(asset, dict):
            continue
        identity = (asset.get("path"), str(asset.get("sha256", "")).upper())
        record = lineage_by_identity.get(identity)
        if not isinstance(record, dict) or record.get("classification") != "admitted-source":
            errors.append(f"construction graph: asset {asset.get('id')} is absent from admitted lineage_inputs")


def validate_v13_final_report(
    name: str,
    check: dict[str, Any],
    root: Path,
    errors: list[str],
    primary_player: dict[str, Any] | None,
) -> None:
    subject_path = check.get("subject_path")
    subject_sha256 = str(check.get("subject_sha256", "")).upper()
    if not isinstance(primary_player, dict):
        errors.append(f"verification.{name}: exact player subject is unavailable")
        return
    if subject_path != primary_player.get("path") or subject_sha256 != str(primary_player.get("sha256", "")).upper():
        errors.append(f"verification.{name}: subject must be the exact primary player map")
    report_path = contained_path(root, check.get("evidence_path"), errors, f"verification.{name}")
    report = read_json(report_path, errors, f"verification.{name} evidence") if report_path else None
    if report is None:
        return
    if report.get("track") != name:
        errors.append(f"verification.{name}: evidence track does not match wrapper")
    if report.get("status") != check.get("status"):
        errors.append(f"verification.{name}: evidence status does not match wrapper")
    if report.get("subject_path") != subject_path or str(report.get("subject_sha256", "")).upper() != subject_sha256:
        errors.append(f"verification.{name}: evidence subject does not match wrapper")


def validate_owner_quality_disposition(
    disposition: Any,
    root: Path,
    errors: list[str],
    primary_player: dict[str, Any] | None,
) -> None:
    if disposition is None:
        return
    if not isinstance(disposition, dict):
        errors.append("owner_quality_disposition must be an object")
        return
    required = ("finding_id", "severity", "affected_claim", "disposition", "decision_by", "original_review_status", "review", "decision_record")
    if any(field not in disposition for field in required):
        errors.append("owner_quality_disposition is incomplete")
        return
    if disposition.get("severity") not in {"hard_blocker", "soft_advisory", "taste_note"}:
        errors.append("owner_quality_disposition has an invalid severity")
    if not isinstance(disposition.get("finding_id"), str) or not disposition["finding_id"]:
        errors.append("owner_quality_disposition needs a finding_id")
    if disposition.get("disposition") not in {"accepted_as_plausible", "retained_as_reference", "rejected"}:
        errors.append("owner_quality_disposition has an invalid disposition")
    if disposition.get("severity") == "hard_blocker" and disposition.get("disposition") != "rejected":
        errors.append("owner_quality_disposition cannot soften a hard_blocker")
    if disposition.get("decision_by") != "Ben":
        errors.append("owner_quality_disposition must name Ben as decision_by")
    review_path = verify_record(disposition.get("review"), root, errors, "owner quality review")
    decision_path = verify_record(disposition.get("decision_record"), root, errors, "owner quality decision record")
    decision = read_json(decision_path, errors, "owner quality decision record") if decision_path else None
    review = read_json(review_path, errors, "owner quality review") if review_path else None
    if review is not None and review.get("status") != disposition.get("original_review_status"):
        errors.append("owner_quality_disposition original_review_status does not match immutable review")
    if review is not None:
        if review.get("finding_id") != disposition.get("finding_id"):
            errors.append("owner_quality_disposition finding_id does not match immutable review")
        if not isinstance(primary_player, dict):
            errors.append("owner_quality_disposition exact player subject is unavailable")
        elif (
            review.get("subject_path") != primary_player.get("path")
            or str(review.get("subject_sha256", "")).upper() != str(primary_player.get("sha256", "")).upper()
        ):
            errors.append("owner_quality_disposition immutable review does not bind the exact player-map subject")
    if decision is None or not isinstance(primary_player, dict):
        return
    expected = {
        "candidate_subject_path": primary_player.get("path"),
        "candidate_subject_sha256": str(primary_player.get("sha256", "")).upper(),
        "review_path": (disposition.get("review") or {}).get("path"),
        "review_sha256": str((disposition.get("review") or {}).get("sha256", "")).upper(),
        "finding_id": disposition.get("finding_id"),
        "severity": disposition.get("severity"),
        "affected_claim": disposition.get("affected_claim"),
        "disposition": disposition.get("disposition"),
        "decision_by": "Ben",
        "original_review_status": disposition.get("original_review_status"),
    }
    for key, value in expected.items():
        actual = str(decision.get(key, "")).upper() if key.endswith("sha256") else decision.get(key)
        if actual != value:
            errors.append(f"owner quality decision record: {key} does not bind the exact disposition")
    if review_path is not None and decision.get("review_path") != (disposition.get("review") or {}).get("path"):
        errors.append("owner quality decision record: review path does not match")


def _validate_identity_manifest(manifest_path: Path, *, current_release: bool = False) -> dict[str, Any]:
    """Check bounded current artifact/source identity without legacy phase machinery."""
    manifest_path = manifest_path.resolve()
    errors: list[str] = []
    manifest = read_json(manifest_path, errors, "draft manifest")
    result = {"ok": False, "status": "draft-only", "draft_ready": False,
              "review_ready": False, "release_ready": False, "errors": errors}
    if manifest is None:
        return result
    expected_name = "release-manifest.json" if current_release else "draft-manifest.json"
    if manifest_path.name != expected_name:
        errors.append(f"manifest filename must be {expected_name}; do not rewrite historical records")
    if current_release:
        expected_fields = {"manifest_version": "1.4", "root": "."}
        if manifest.get("status") not in ("candidate", "accepted"):
            errors.append("current release status must be candidate or accepted")
    else:
        expected_fields = {"draft_version": "1.0", "status": "draft-only", "label": "DRAFT-ONLY",
                           "scope": "private-local-review", "root": ".", "decision": "pending"}
    for key, expected in expected_fields.items():
        if manifest.get(key) != expected:
            errors.append(f"draft {key} must be {expected}")
    for key in ("commission", "provenance_note"):
        if not isinstance(manifest.get(key), str) or not manifest[key].strip():
            errors.append(f"draft {key} must identify the existing scope/source history")
    for key in ("known_limitations", "unperformed_checks"):
        values = manifest.get(key)
        if not isinstance(values, list) or any(not isinstance(v, str) or not v.strip() for v in values):
            errors.append(f"draft {key} must be an array of explicit descriptions")
    excluded = manifest.get("excluded_identities")
    excluded_hashes: set[str] = set()
    if not isinstance(excluded, list):
        errors.append("draft excluded_identities must preserve relevant rejected/contaminated history")
    else:
        for item in excluded:
            if not isinstance(item, dict) or not SHA256_RE.fullmatch(str(item.get("sha256", ""))) or not item.get("reason"):
                errors.append("draft excluded identity requires exact sha256 and reason")
            else:
                excluded_hashes.add(item["sha256"].upper())
    root = manifest_path.parent
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        errors.append("draft artifacts must be a non-empty array")
        artifacts = []
    sources = manifest.get("lineage_inputs")
    if not isinstance(sources, list):
        errors.append("draft lineage_inputs must list every production source")
        sources = []
    seen: set[str] = set()
    for index, record in enumerate(artifacts + sources):
        label = f"draft file {index}"
        path = verify_record(record, root, errors, label)
        if not isinstance(record, dict):
            continue
        if path is not None:
            canonical = str(path).casefold()
            if canonical in seen:
                errors.append(f"{label}: duplicate resolved path")
            seen.add(canonical)
        if str(record.get("sha256", "")).upper() in excluded_hashes:
            errors.append(f"{label}: excluded pixels cannot enter a draft or its lineage")
        expected_eligible = current_release and index < len(artifacts) and manifest.get("status") == "accepted"
        if record.get("release_eligible") is not expected_eligible:
            errors.append(f"{label}: release_eligible does not match the explicit manifest state")
        if index < len(artifacts):
            disposition = manifest.get("status") if current_release else "draft-only"
            if record.get("disposition") != disposition or record.get("release_artifact") is not current_release:
                errors.append(f"{label}: artifact flags/disposition do not match the explicit manifest state")
        elif record.get("classification") != "admitted-source":
            errors.append(f"{label}: only clean admitted production sources may enter draft lineage")
    if not any(isinstance(a, dict) and a.get("role") == "player_map" for a in artifacts):
        errors.append("draft must identify its player_map")
    result["ok"] = result["draft_ready"] = not errors
    result["artifact_count"] = len(artifacts)
    return result


def validate_draft_manifest(manifest_path: Path) -> dict[str, Any]:
    """Private WIP identity only; never confer review or release readiness."""
    return _validate_identity_manifest(manifest_path)


def validate_current_manifest(manifest_path: Path) -> dict[str, Any]:
    """Validate v1.4 final evidence and exact owner acceptance without phase reports."""
    result = _validate_identity_manifest(manifest_path, current_release=True)
    errors = result["errors"]
    manifest_path = manifest_path.resolve()
    manifest = read_json(manifest_path, errors, "current manifest")
    if manifest is None:
        return result
    root = manifest_path.parent
    result["draft_ready"] = False
    result["status"] = manifest.get("status")
    artifacts = manifest.get("artifacts")
    artifacts = artifacts if isinstance(artifacts, list) else []
    identities = [{"path": a.get("path"), "sha256": str(a.get("sha256", "")).upper()}
                  for a in artifacts if isinstance(a, dict)]
    if sum(a.get("role") == "player_map" for a in artifacts if isinstance(a, dict)) != 1:
        errors.append("current manifest needs exactly one primary player_map")
    if manifest.get("known_limitations") or manifest.get("unperformed_checks"):
        errors.append("complete review cannot retain limitations or unperformed checks; use DRAFT-ONLY")
    author = manifest.get("author")
    if not isinstance(author, str) or not author.strip():
        errors.append("current manifest requires the production author identity")
    review_path = verify_record(manifest.get("independent_review"), root, errors, "independent final review")
    review = read_json(review_path, errors, "independent final review") if review_path else None
    if review is not None:
        reviewer = review.get("reviewer")
        if not isinstance(reviewer, str) or not reviewer.strip() or reviewer.strip().casefold() == str(author).strip().casefold():
            errors.append("final review must identify an independent reviewer, not the author")
        if review.get("status") != "pass" or review.get("context") not in ("fresh-actual-artifact", "independent-targeted-recheck"):
            errors.append("final review must pass with actual-artifact cold or independent targeted-recheck evidence")
        if review.get("context") == "independent-targeted-recheck":
            original_path = verify_record(review.get("original_cold_review"), root, errors, "original independent cold report")
            original = read_json(original_path, errors, "original independent cold report") if original_path else None
            if original_path == review_path:
                errors.append("targeted recheck must preserve a separate immutable original cold report")
            if original is not None:
                original_reviewer = original.get("reviewer")
                if not isinstance(original_reviewer, str) or not original_reviewer.strip() or original_reviewer.strip().casefold() == str(author).strip().casefold():
                    errors.append("original cold report must identify an independent reviewer")
                if original.get("context") != "fresh-actual-artifact" or original.get("status") not in ("pass", "fail"):
                    errors.append("targeted recheck must reference an actual original cold report, not another recheck")
                original_artifacts = original.get("artifacts")
                if not isinstance(original_artifacts, list) or not original_artifacts or any(
                    not isinstance(a, dict) or not isinstance(a.get("path"), str) or not a["path"].strip()
                    or not SHA256_RE.fullmatch(str(a.get("sha256", ""))) for a in original_artifacts
                ):
                    errors.append("original cold report must preserve its exact reviewed artifact identities")
            for field in ("affected_scope", "recheck_evidence"):
                if not isinstance(review.get(field), str) or not review[field].strip():
                    errors.append(f"independent targeted recheck requires concrete {field}")
        if review.get("artifacts") != identities:
            errors.append("final review must bind every exact artifact path/hash in manifest order")
        if review.get("lineage_inputs") != manifest.get("lineage_inputs") or review.get("excluded_identities") != manifest.get("excluded_identities"):
            errors.append("final review must bind the exact production lineage and excluded history")
        claims = review.get("claims")
        claims = claims if isinstance(claims, dict) else {}
        for claim in CHECK_NAMES:
            evidence = claims.get(claim)
            if not isinstance(evidence, dict) or evidence.get("status") != "pass" or not isinstance(evidence.get("evidence"), str) or not evidence["evidence"].strip():
                errors.append(f"final review requires concrete passing evidence for {claim}")
        if review.get("unresolved_material_findings") != []:
            errors.append("final review must have no unresolved material findings")
    decision = manifest.get("decision")
    decision = decision if isinstance(decision, dict) else {}
    if manifest.get("status") == "accepted":
        if decision.get("status") != "accepted" or decision.get("by") != "Ben":
            errors.append("accepted current manifest requires Ben's explicit accepted decision")
        decision_path = verify_record(decision.get("record"), root, errors, "Ben acceptance record")
        accepted = read_json(decision_path, errors, "Ben acceptance record") if decision_path else None
        if accepted is not None:
            if accepted.get("by") != "Ben" or accepted.get("status") != "accepted" or accepted.get("artifacts") != identities:
                errors.append("Ben acceptance record must bind the exact accepted artifacts")
            for field in ("instruction_source", "instruction_quote"):
                if not isinstance(accepted.get(field), str) or not accepted[field].strip():
                    errors.append(f"Ben acceptance record requires {field}; a validator cannot invent consent")
    elif decision.get("status") != "pending":
        errors.append("candidate current manifest requires a pending decision")
    result["ok"] = not errors
    result["review_ready"] = not errors
    result["release_ready"] = not errors and manifest.get("status") == "accepted"
    return result


def validate_manifest(
    manifest_path: Path,
    require_accepted: bool = False,
    require_review_admission: bool = False,
) -> dict[str, Any]:
    manifest_path = manifest_path.resolve()
    errors: list[str] = []
    if manifest_path.name != "release-manifest.json":
        errors.append("manifest filename must be exactly release-manifest.json")
    if manifest_path.parent.is_dir():
        siblings = [p for p in manifest_path.parent.glob("release-manifest*.json") if p.resolve() != manifest_path]
        if siblings:
            errors.append("release folder contains more than one release-manifest*.json")
    manifest = read_json(manifest_path, errors, "manifest")
    if manifest is None:
        return {"ok": False, "status": None, "review_ready": False, "release_ready": False, "errors": errors}
    manifest_version = manifest.get("manifest_version")
    if manifest_version == "1.4":
        result = validate_current_manifest(manifest_path)
        result["errors"][:0] = errors
        if require_accepted and result["status"] != "accepted":
            result["errors"].append("--require-accepted requires Ben-accepted status")
        if result["errors"]:
            result.update(ok=False, review_ready=False, release_ready=False)
        return result
    if manifest_version not in {"1.2", "1.3"}:
        errors.append("manifest_version must be 1.2 or 1.3")
    strict_v13 = manifest_version == "1.3"
    status = manifest.get("status")
    if status not in STATUSES:
        errors.append(f"status must be one of {sorted(STATUSES)}")
    root_token = manifest.get("root")
    if root_token not in {".", ".."}:
        errors.append("root must be '.' or '..' to keep validation bounded")
        root = manifest_path.parent
    else:
        root = (manifest_path.parent / root_token).resolve()
    if not root.is_dir():
        errors.append(f"manifest root is not a directory: {root}")
    brief_path = verify_record(manifest.get("brief"), root, errors, "brief record")
    graph_path = verify_record(manifest.get("construction_graph"), root, errors, "construction graph record")
    validate_brief(brief_path, errors)
    graph = validate_graph(graph_path, root, errors, strict_v13=strict_v13)

    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        errors.append("artifacts must be a non-empty array")
        artifacts = []
    seen_paths: set[str] = set()
    primary_players = 0
    eligible_players = 0
    primary_player: dict[str, Any] | None = None
    for index, artifact in enumerate(artifacts):
        label = f"artifact {index}"
        verify_record(artifact, root, errors, label)
        if not isinstance(artifact, dict):
            continue
        path_text = artifact.get("path")
        if path_text in seen_paths:
            errors.append(f"{label}: duplicate artifact path {path_text}")
        if isinstance(path_text, str):
            seen_paths.add(path_text)
        if artifact.get("role") == "player_map" and artifact.get("release_artifact") is True:
            primary_players += 1
            primary_player = artifact
            if artifact.get("release_eligible") is True:
                eligible_players += 1
        if not isinstance(artifact.get("release_artifact"), bool) or not isinstance(artifact.get("release_eligible"), bool):
            errors.append(f"{label}: release flags must be boolean")
        if status != "accepted" and artifact.get("release_eligible") is True:
            errors.append(f"{label}: {status} manifest cannot mark an artifact release-eligible")
        if status == "accepted":
            if artifact.get("release_artifact") is True:
                if artifact.get("release_eligible") is not True or artifact.get("disposition") != "accepted":
                    errors.append(f"{label}: accepted release artifact must be eligible with accepted disposition")
            elif artifact.get("release_eligible") is True:
                errors.append(f"{label}: evidence-only artifact cannot be release-eligible")
    if primary_players != 1:
        errors.append("manifest must name exactly one player_map release artifact")

    verification = manifest.get("verification")
    if not isinstance(verification, dict):
        errors.append("verification must be an object with five tracks")
        verification = {}
    evidence_paths: list[str] = []
    for name in CHECK_NAMES:
        check = verification.get(name)
        if not isinstance(check, dict):
            errors.append(f"verification.{name}: record is required")
            continue
        verify_record({"path": check.get("evidence_path"), "sha256": check.get("evidence_sha256")}, root, errors, f"verification.{name}")
        if isinstance(check.get("evidence_path"), str):
            evidence_paths.append(check["evidence_path"])
        if check.get("status") not in {"pass", "fail", "pending"}:
            errors.append(f"verification.{name}: status must be pass, fail, or pending")
        if strict_v13:
            validate_v13_final_report(name, check, root, errors, primary_player)
    if len(set(evidence_paths)) != len(CHECK_NAMES):
        errors.append("the five verification tracks must use five distinct evidence files")

    lineage_inputs = manifest.get("lineage_inputs")
    if not isinstance(lineage_inputs, list):
        errors.append("lineage_inputs must be an array")
        lineage_inputs = []
    for index, record in enumerate(lineage_inputs):
        verify_record(record, root, errors, f"lineage input {index}", external_allowed=True)
        if not isinstance(record, dict) or record.get("release_eligible") is not False:
            errors.append(f"lineage input {index}: release_eligible must be false")
    if strict_v13:
        validate_v13_graph_lineage(graph, lineage_inputs, errors)

    rejected = manifest.get("rejected_candidates")
    if not isinstance(rejected, list):
        errors.append("rejected_candidates must be an array")
        rejected = []
    for index, record in enumerate(rejected):
        if not isinstance(record, dict):
            errors.append(f"rejected candidate {index}: record must be an object")
            continue
        if record.get("release_eligible") is not False:
            errors.append(f"rejected candidate {index}: release_eligible must be false")
        if not SHA256_RE.fullmatch(str(record.get("sha256", ""))):
            errors.append(f"rejected candidate {index}: exact sha256 is required")

    verify_record(manifest.get("metrics"), root, errors, "metrics record")
    decision = manifest.get("decision") or {}
    if strict_v13:
        validate_owner_quality_disposition(manifest.get("owner_quality_disposition"), root, errors, primary_player)
    if status == "accepted":
        if any((verification.get(name) or {}).get("status") != "pass" for name in CHECK_NAMES):
            errors.append("accepted manifest requires all five verification tracks to pass")
        if decision.get("status") != "accepted":
            errors.append("accepted manifest requires an accepted decision record")
        if eligible_players != 1:
            errors.append("accepted manifest requires exactly one eligible player map")
    elif status == "candidate" and decision.get("status") != "pending":
        errors.append("candidate manifest requires a pending decision")
    elif status == "rejected" and decision.get("status") != "rejected":
        errors.append("rejected manifest requires a rejected decision")

    cadence = manifest.get("cadence") or {}
    proof_count = cadence.get("unrelated_consecutive_proofs")
    if not isinstance(proof_count, int) or proof_count < 0:
        errors.append("cadence.unrelated_consecutive_proofs must be a non-negative integer")
    if cadence.get("maturity_claimed") is True and (not isinstance(proof_count, int) or proof_count < 2):
        errors.append("cadence maturity cannot be claimed without two consecutive unrelated proofs")
    if require_accepted and status != "accepted":
        errors.append("--require-accepted was set but manifest status is not accepted")
    if require_accepted and not strict_v13:
        errors.append("--require-accepted requires a v1.3 manifest; v1.2 is historical inspection only")
    if require_review_admission and not strict_v13:
        errors.append("--require-review-admission requires a v1.3 manifest; historical records are not review-product inputs")
    if require_review_admission and status not in REVIEW_ADMISSION_STATUSES:
        errors.append("--require-review-admission requires manifest status candidate or accepted")

    ok = not errors
    return {
        "ok": ok,
        "status": status,
        "review_ready": ok and strict_v13 and status in REVIEW_ADMISSION_STATUSES,
        "release_ready": ok and strict_v13 and status == "accepted",
        "artifact_count": len(artifacts),
        "verification_tracks": len(verification),
        "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--require-accepted", action="store_true")
    parser.add_argument("--require-review-admission", action="store_true")
    parser.add_argument("--draft-only", action="store_true", help="validate a separate private WIP draft-manifest.json; never release-ready")
    args = parser.parse_args()
    if args.draft_only:
        if args.require_accepted or args.require_review_admission:
            parser.error("--draft-only cannot be combined with review-admission or accepted release flags")
        result = validate_draft_manifest(args.manifest)
    else:
        result = validate_manifest(
            args.manifest,
            require_accepted=args.require_accepted,
            require_review_admission=args.require_review_admission,
        )
    print(json.dumps(result, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
