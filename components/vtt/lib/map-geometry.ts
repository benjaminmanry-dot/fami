import type { BattleMap, GridCalibration, GridPoint } from "@/lib/room-state";

export function mapGridGeometry(map: BattleMap): GridCalibration {
  return map.grid ?? {
    offsetX: 0,
    offsetY: 0,
    cellWidth: 1 / map.columns,
    cellHeight: 1 / map.rows,
    imageAspect: map.columns / map.rows,
  };
}

export function normalizeMapPoint(point: GridPoint, map: BattleMap): GridPoint {
  const grid = mapGridGeometry(map);
  return {
    x: grid.offsetX + point.x * grid.cellWidth,
    y: grid.offsetY + point.y * grid.cellHeight,
  };
}

export function gridPosition(position: number, offset: number, cellSize: number): string {
  return `${(offset + position * cellSize) * 100}%`;
}

export function reanchorSegment(
  start: GridPoint,
  end: GridPoint,
  target: GridPoint,
  columns: number,
  rows: number,
): { start: GridPoint; end: GridPoint } {
  const desiredX = target.x - (start.x + end.x) / 2;
  const desiredY = target.y - (start.y + end.y) / 2;
  const shiftX = clamp(desiredX, -Math.min(start.x, end.x), columns - Math.max(start.x, end.x));
  const shiftY = clamp(desiredY, -Math.min(start.y, end.y), rows - Math.max(start.y, end.y));
  return {
    start: { x: start.x + shiftX, y: start.y + shiftY },
    end: { x: end.x + shiftX, y: end.y + shiftY },
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
