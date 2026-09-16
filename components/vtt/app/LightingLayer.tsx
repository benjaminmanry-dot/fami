"use client";

import { useEffect, useId, useMemo } from "react";
import { cellsInsidePolygons, type ViewerLighting } from "@/lib/lighting";
import { mapGridGeometry, normalizeMapPoint } from "@/lib/map-geometry";
import type { BattleMap, GridPoint, MapLight, SightBarrier } from "@/lib/room-state";

export type BarrierPreview = Pick<SightBarrier, "start" | "end" | "kind">;

export function LightingLayer({
  map,
  viewerId,
  isDm,
  previewPlayers,
  showControls,
  visibility,
  draftBarriers,
  draftLights,
  drawing,
  selectedBarrierId,
  selectedDraftBarrierIndex,
  onDoorToggle,
  onBarrierSelect,
  onDraftSelect,
  onLightRemove,
  onDraftLightRemove,
  onReveal,
}: {
  map: BattleMap;
  viewerId: string;
  isDm: boolean;
  previewPlayers: boolean;
  showControls: boolean;
  visibility: ViewerLighting;
  draftBarriers: BarrierPreview[];
  draftLights: MapLight[];
  drawing: BarrierPreview[];
  selectedBarrierId: string | null;
  selectedDraftBarrierIndex: number | null;
  onDoorToggle(id: string): void;
  onBarrierSelect(id: string): void;
  onDraftSelect(index: number): void;
  onLightRemove(id: string): void;
  onDraftLightRemove(index: number): void;
  onReveal(mapId: string, scope: string, cells: number[]): Promise<void>;
}) {
  const lighting = map.lighting;
  const maskId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const exploredCells = useMemo(() => {
    if (!lighting) return [];
    return [...new Set([
      ...(lighting.explored.shared ?? []),
      ...(lighting.explored[viewerId] ?? []),
    ])];
  }, [lighting, viewerId]);
  const newSharedCells = useMemo(
    () => missingCells(visibility.sharedPolygons, lighting?.explored.shared, map),
    [visibility.sharedPolygons, lighting?.explored.shared, map],
  );
  const newPrivateCells = useMemo(
    () => missingCells(visibility.privatePolygons, lighting?.explored[viewerId], map),
    [visibility.privatePolygons, lighting?.explored, map, viewerId],
  );

  useEffect(() => {
    if (!lighting?.enabled || (!newSharedCells.length && !newPrivateCells.length)) return;
    void (async () => {
      if (newSharedCells.length) await onReveal(map.id, "shared", newSharedCells);
      if (newPrivateCells.length) await onReveal(map.id, viewerId, newPrivateCells);
    })();
  }, [lighting?.enabled, map.id, newPrivateCells, newSharedCells, onReveal, viewerId]);

  const showFog = lighting?.enabled && (!isDm || previewPlayers);
  const exploredPath = cellPath(exploredCells, map);
  const visiblePath = polygonPath(visibility.polygons, map);

  return (
    <svg
      className="lighting-layer"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-label={showControls ? "Dynamic-lighting walls and doors" : "Dynamic lighting"}
    >
      <defs>
        <mask id={`${maskId}-fog`} maskUnits="userSpaceOnUse" x="0" y="0" width="1" height="1">
          <rect width="1" height="1" fill="white" />
          {exploredPath && <path d={exploredPath} fill="#777" />}
          {visiblePath && <path d={visiblePath} fill="black" />}
        </mask>
      </defs>

      {showFog && (
        <rect
          className="fog-curtain"
          width="1"
          height="1"
          fill="black"
          opacity={lighting.darkness}
          mask={`url(#${maskId}-fog)`}
        />
      )}

      {showControls && draftLights.map((light, index) => (
        <LightMarker
          key={light.id}
          light={light}
          map={map}
          onAction={() => onDraftLightRemove(index)}
          actionLabel="Remove draft light"
        />
      ))}
      {showControls && lighting?.lights.map((light) => (
        <LightMarker
          key={light.id}
          light={light}
          map={map}
          accepted
          onAction={() => onLightRemove(light.id)}
          actionLabel="Remove light"
        />
      ))}

      {showControls && lighting?.barriers.map((barrier) => (
        <BarrierLine
          key={barrier.id}
          barrier={barrier}
          map={map}
          selected={selectedBarrierId === barrier.id}
          onAction={barrier.kind === "door"
            ? () => onDoorToggle(barrier.id)
            : () => onBarrierSelect(barrier.id)}
          actionLabel={barrier.kind === "door"
            ? `${barrier.open ? "Close" : "Open"} door`
            : "Select wall for re-anchoring"}
        />
      ))}
      {showControls && draftBarriers.map((barrier, index) => (
        <BarrierLine
          key={`draft-${index}`}
          barrier={{ ...barrier, id: `draft-${index}`, open: false }}
          map={map}
          draft
          selected={selectedDraftBarrierIndex === index}
          onAction={() => onDraftSelect(index)}
          actionLabel="Select draft wall for re-anchoring"
        />
      ))}
      {showControls && drawing.map((barrier, index) => (
        <BarrierLine key={`drawing-${index}`} barrier={{ ...barrier, id: `drawing-${index}`, open: false }} map={map} draft />
      ))}
    </svg>
  );
}

function LightMarker({
  light,
  map,
  onAction,
  actionLabel,
  accepted = false,
}: {
  light: MapLight;
  map: BattleMap;
  onAction(): void;
  actionLabel: string;
  accepted?: boolean;
}) {
  const center = normalizeMapPoint(light, map);
  const grid = mapGridGeometry(map);
  return (
    <ellipse
      className={`map-light-marker ${accepted ? "accepted" : "draft"}`}
      data-lighting-control="light"
      cx={center.x}
      cy={center.y}
      rx={grid.cellWidth * 0.32}
      ry={grid.cellHeight * 0.32}
      fill={light.color}
      role="button"
      tabIndex={0}
      aria-label={actionLabel}
      onClick={(event) => {
        event.stopPropagation();
        onAction();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onAction();
        }
      }}
    />
  );
}

function BarrierLine({
  barrier,
  map,
  draft = false,
  selected = false,
  onAction,
  actionLabel,
}: {
  barrier: SightBarrier;
  map: BattleMap;
  draft?: boolean;
  selected?: boolean;
  onAction?: () => void;
  actionLabel?: string;
}) {
  const start = normalizeMapPoint(barrier.start, map);
  const end = normalizeMapPoint(barrier.end, map);
  return (
    <line
      className={`sight-barrier ${barrier.kind} ${barrier.open ? "open" : "closed"} ${draft ? "draft" : ""} ${selected ? "selected" : ""}`}
      data-lighting-control={onAction ? barrier.kind : undefined}
      x1={start.x}
      y1={start.y}
      x2={end.x}
      y2={end.y}
      role={onAction ? "button" : undefined}
      tabIndex={onAction ? 0 : undefined}
      aria-label={actionLabel}
      aria-pressed={onAction && barrier.kind === "wall" ? selected : undefined}
      onClick={(event) => {
        if (!onAction) return;
        event.stopPropagation();
        onAction();
      }}
      onKeyDown={(event) => {
        if (onAction && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onAction();
        }
      }}
    />
  );
}

function missingCells(
  polygons: GridPoint[][],
  existing: number[] | undefined,
  map: BattleMap,
): number[] {
  if (!polygons.length) return [];
  const explored = new Set(existing ?? []);
  return cellsInsidePolygons(polygons, map.columns, map.rows)
    .filter((cell) => !explored.has(cell));
}

function polygonPath(polygons: GridPoint[][], map: BattleMap): string {
  return polygons.map((polygon) => {
    const points = polygon.map((point) => normalizeMapPoint(point, map));
    return points.length
      ? `M${points.map((point) => `${point.x},${point.y}`).join("L")}Z`
      : "";
  }).join("");
}

function cellPath(cells: number[], map: BattleMap): string {
  const grid = mapGridGeometry(map);
  return cells.map((cell) => {
    const x = cell % map.columns;
    const y = Math.floor(cell / map.columns);
    const left = grid.offsetX + x * grid.cellWidth;
    const top = grid.offsetY + y * grid.cellHeight;
    return `M${left},${top}h${grid.cellWidth}v${grid.cellHeight}h-${grid.cellWidth}Z`;
  }).join("");
}
