"use client";

import { buildMeasurementGeometry, type MeasurementTemplate } from "@/lib/measurement";
import { normalizeMapPoint } from "@/lib/map-geometry";
import type { BattleMap } from "@/lib/room-state";

export function MeasurementLayer({ map, template }: { map: BattleMap; template: MeasurementTemplate }) {
  const geometry = buildMeasurementGeometry(template);
  const points = geometry.points.map((point) => normalizeMapPoint(point, map));
  const label = normalizeMapPoint(geometry.label, map);

  return (
    <div className={`measure-layer template-${template.kind}`} aria-live="polite">
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {template.kind === "distance" ? (
          <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" />
        ) : (
          <polygon points={points.map((point) => `${point.x},${point.y}`).join(" ")} />
        )}
      </svg>
      <span style={{ left: `${label.x * 100}%`, top: `${label.y * 100}%` }}>
        {template.kind === "beam" ? `${geometry.distanceFeet} ft × ${template.beamWidth * 5} ft` : `${geometry.distanceFeet} ft`}
      </span>
    </div>
  );
}
