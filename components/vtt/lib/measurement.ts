import type { GridPoint } from "@/lib/room-state";

export type MeasurementKind = "distance" | "cone" | "square" | "beam" | "emanation";

export type MeasurementTemplate = {
  kind: MeasurementKind;
  start: GridPoint;
  end: GridPoint;
  beamWidth: number;
  joints?: GridPoint[];
};

export type MeasurementGeometry = {
  points: GridPoint[];
  label: GridPoint;
  distanceFeet: number;
};

export function buildMeasurementGeometry(template: MeasurementTemplate): MeasurementGeometry {
  const { start, end } = template;
  const path = [start, ...(template.joints ?? []), end];
  if (template.kind === "distance") {
    return {
      points: path,
      label: end,
      distanceFeet: path.slice(1).reduce((total, point, index) => {
        const previous = path[index];
        return total + Math.ceil(Math.max(
          Math.abs(point.x - previous.x),
          Math.abs(point.y - previous.y),
        )) * 5;
      }, 0),
    };
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const range = Math.max(Math.abs(dx), Math.abs(dy));
  const cells = Math.max(1, Math.ceil(range));
  const distanceFeet = Math.ceil(range) * 5;

  if (template.kind === "square") {
    const signX = dx < 0 ? -1 : 1;
    const signY = dy < 0 ? -1 : 1;
    const opposite = { x: start.x + signX * cells, y: start.y + signY * cells };
    return {
      points: [
        start,
        { x: opposite.x, y: start.y },
        opposite,
        { x: start.x, y: opposite.y },
      ],
      label: opposite,
      distanceFeet: cells * 5,
    };
  }
  if (template.kind === "emanation") {
    return {
      points: [
        { x: start.x - cells, y: start.y - cells },
        { x: start.x + cells, y: start.y - cells },
        { x: start.x + cells, y: start.y + cells },
        { x: start.x - cells, y: start.y + cells },
      ],
      label: { x: start.x + cells, y: start.y + cells },
      distanceFeet: cells * 5,
    };
  }

  const euclidean = Math.hypot(dx, dy) || 1;
  const direction = { x: dx / euclidean, y: dy / euclidean };
  const perpendicular = { x: -direction.y, y: direction.x };
  const halfWidth = template.kind === "cone" ? cells / 2 : template.beamWidth / 2;
  return {
    points: template.kind === "cone"
      ? [
          start,
          { x: end.x + perpendicular.x * halfWidth, y: end.y + perpendicular.y * halfWidth },
          { x: end.x - perpendicular.x * halfWidth, y: end.y - perpendicular.y * halfWidth },
        ]
      : [
          { x: start.x + perpendicular.x * halfWidth, y: start.y + perpendicular.y * halfWidth },
          { x: end.x + perpendicular.x * halfWidth, y: end.y + perpendicular.y * halfWidth },
          { x: end.x - perpendicular.x * halfWidth, y: end.y - perpendicular.y * halfWidth },
          { x: start.x - perpendicular.x * halfWidth, y: start.y - perpendicular.y * halfWidth },
        ],
    label: end,
    distanceFeet,
  };
}
