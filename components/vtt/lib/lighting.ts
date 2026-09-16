import type {
  BattleMap,
  GridCalibration,
  GridPoint,
  MapLight,
  SightBarrier,
  TableToken,
} from "@/lib/room-state";

type Segment = { start: GridPoint; end: GridPoint };
type CellFeature = [number, number, number, number];

export type ViewerLighting = {
  sharedPolygons: GridPoint[][];
  privatePolygons: GridPoint[][];
  polygons: GridPoint[][];
};

export function buildViewerLighting(
  map: BattleMap,
  tokens: TableToken[],
  viewerId: string,
): ViewerLighting {
  const lighting = map.lighting;
  if (!lighting?.enabled) {
    return { sharedPolygons: [], privatePolygons: [], polygons: [] };
  }

  const tokenSources = tokens.map((token) => ({
    token,
    point: {
      x: token.x + (token.width ?? 1) / 2,
      y: token.y + (token.height ?? 1) / 2,
    },
  }));
  const sharedSources = tokenSources.filter(({ token }) => token.sharedSight !== false);
  const privateSources = tokenSources.filter(
    ({ token }) => token.sharedSight === false && token.ownerId === viewerId,
  );
  const polygonsFor = (sources: typeof tokenSources) => sources.map(({ token, point }) =>
    visibilityPolygon(
      point,
      lighting.barriers,
      map.columns,
      map.rows,
      token.visionRange ?? 12,
    ),
  );
  const sharedPolygons = polygonsFor(sharedSources);
  const privatePolygons = polygonsFor(privateSources);
  for (const light of lighting.lights) {
    const visibleFromShared = sharedPolygons.some((polygon) => pointInPolygon(light, polygon));
    const visibleFromPrivate = privatePolygons.some((polygon) => pointInPolygon(light, polygon));
    if (!visibleFromShared && !visibleFromPrivate) continue;
    const polygon = visibilityPolygon(
      light,
      lighting.barriers,
      map.columns,
      map.rows,
      light.range,
    );
    (visibleFromShared ? sharedPolygons : privatePolygons).push(polygon);
  }

  return {
    sharedPolygons,
    privatePolygons,
    polygons: [...sharedPolygons, ...privatePolygons],
  };
}

export function visibilityPolygon(
  origin: GridPoint,
  barriers: SightBarrier[],
  columns: number,
  rows: number,
  range: number,
): GridPoint[] {
  const segments = blockingSegments(barriers, columns, rows);
  const angles = new Set<number>();

  for (let index = 0; index < 96; index += 1) {
    angles.add((index / 96) * Math.PI * 2);
  }
  for (const segment of segments) {
    for (const point of [segment.start, segment.end]) {
      const angle = Math.atan2(point.y - origin.y, point.x - origin.x);
      angles.add(normalizeAngle(angle - 0.00001));
      angles.add(normalizeAngle(angle));
      angles.add(normalizeAngle(angle + 0.00001));
    }
  }

  return [...angles]
    .sort((left, right) => left - right)
    .map((angle) => castRay(origin, angle, range, segments));
}

function normalizeAngle(angle: number): number {
  const turn = Math.PI * 2;
  return ((angle % turn) + turn) % turn;
}

export function pointInPolygon(point: GridPoint, polygon: GridPoint[]): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function cellsInsidePolygons(
  polygons: GridPoint[][],
  columns: number,
  rows: number,
): number[] {
  const cells: number[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      if (polygons.some((polygon) => pointInPolygon({ x: x + 0.5, y: y + 0.5 }, polygon))) {
        cells.push(y * columns + x);
      }
    }
  }
  return cells;
}

export function hasLineOfSight(
  start: GridPoint,
  end: GridPoint,
  barriers: SightBarrier[],
): boolean {
  return !barriers.some(
    (barrier) =>
      !(barrier.kind === "door" && barrier.open) &&
      segmentsIntersect(start, end, barrier.start, barrier.end),
  );
}

export function inferArtworkWallDraft(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  map: Pick<BattleMap, "columns" | "rows">,
  grid: GridCalibration,
): Segment[] {
  if (pixels.length < width * height * 4) return [];
  const aspect = width / height;
  const analysisColumns = Math.max(24, Math.round(aspect >= 1 ? 64 : 64 * aspect));
  const analysisRows = Math.max(24, Math.round(aspect >= 1 ? 64 / aspect : 64));
  const artworkGrid: GridCalibration = {
    offsetX: 0,
    offsetY: 0,
    cellWidth: 1 / analysisColumns,
    cellHeight: 1 / analysisRows,
    imageAspect: aspect,
  };
  // ponytail: color clustering is a reviewable heuristic; use semantic segmentation only if real map failures justify it.
  const features = Array.from({ length: analysisRows }, (_, y) =>
    Array.from({ length: analysisColumns }, (_, x) =>
      sampleCell(pixels, width, height, x, y, artworkGrid),
    ),
  );
  const flatFeatures = features.flat();
  const assignments = clusterCells(flatFeatures, Math.min(6, flatFeatures.length));
  const floorCluster = chooseFloorCluster(flatFeatures, assignments);
  if (floorCluster === null) return [];
  const floorFeature = featureForCluster(floorCluster, flatFeatures, assignments);
  const relatedFloorClusters = new Set(
    [...new Set(assignments)].filter((cluster) =>
      featureDistance(featureForCluster(cluster, flatFeatures, assignments), floorFeature) <= 62,
    ),
  );
  const floorMask = cleanFloorMask(
    assignments.map((cluster) => relatedFloorClusters.has(cluster)),
    analysisColumns,
    analysisRows,
  );
  const isFloor = (x: number, y: number) =>
    floorMask[y * analysisColumns + x];
  const candidates: Array<Segment & { axis: "vertical" | "horizontal" }> = [];

  for (let y = 0; y < analysisRows; y += 1) {
    for (let x = 1; x < analysisColumns; x += 1) {
      if (isFloor(x - 1, y) !== isFloor(x, y)) {
        candidates.push({
          start: { x, y },
          end: { x, y: y + 1 },
          axis: "vertical",
        });
      }
    }
  }
  for (let y = 1; y < analysisRows; y += 1) {
    for (let x = 0; x < analysisColumns; x += 1) {
      if (isFloor(x, y - 1) !== isFloor(x, y)) {
        candidates.push({
          start: { x, y },
          end: { x: x + 1, y },
          axis: "horizontal",
        });
      }
    }
  }
  return mergeSegments(candidates)
    .map((segment) => ({
      start: artworkPointToMap(segment.start, analysisColumns, analysisRows, map, grid),
      end: artworkPointToMap(segment.end, analysisColumns, analysisRows, map, grid),
    }))
    .filter((segment) => Math.hypot(
      segment.end.x - segment.start.x,
      segment.end.y - segment.start.y,
    ) > 0.02)
    .slice(0, 400);
}

export function inferArtworkLightDraft(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  map: Pick<BattleMap, "columns" | "rows">,
  grid: GridCalibration,
): Array<Omit<MapLight, "id">> {
  if (pixels.length < width * height * 4) return [];
  const aspect = width / height;
  const columns = Math.max(32, Math.round(aspect >= 1 ? 96 : 96 * aspect));
  const rows = Math.max(32, Math.round(aspect >= 1 ? 96 / aspect : 96));
  const artworkGrid: GridCalibration = {
    offsetX: 0,
    offsetY: 0,
    cellWidth: 1 / columns,
    cellHeight: 1 / rows,
    imageAspect: aspect,
  };
  const features = Array.from({ length: rows * columns }, (_, index) =>
    sampleLightCell(pixels, width, height, index % columns, Math.floor(index / columns), artworkGrid),
  );
  const averageFeatures = Array.from({ length: rows * columns }, (_, index) =>
    sampleCell(pixels, width, height, index % columns, Math.floor(index / columns), artworkGrid),
  );
  const luminances = features.map(luminanceFor);
  const brightCutoff = [...luminances].sort((left, right) => left - right)[
    Math.floor((luminances.length - 1) * 0.92)
  ];
  const candidates = features.flatMap((feature, index) => {
    const x = index % columns;
    const y = Math.floor(index / columns);
    const nearbyColor = [0, 0, 0];
    let nearbyCells = 0;
    for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
      for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
        if (!offsetX && !offsetY) continue;
        const nearbyX = x + offsetX;
        const nearbyY = y + offsetY;
        if (nearbyX < 0 || nearbyX >= columns || nearbyY < 0 || nearbyY >= rows) continue;
        const nearby = averageFeatures[nearbyY * columns + nearbyX];
        nearbyColor[0] += nearby[0];
        nearbyColor[1] += nearby[1];
        nearbyColor[2] += nearby[2];
        nearbyCells += 1;
      }
    }
    const light = luminances[index];
    const ring = nearbyColor.map((value) => value / Math.max(1, nearbyCells));
    const contrast = luminanceFor(averageFeatures[index]) - luminanceFor([...ring, 0] as CellFeature);
    const chroma = Math.max(feature[0], feature[1], feature[2]) - Math.min(feature[0], feature[1], feature[2]);
    const haloChroma = Math.max(...ring) - Math.min(...ring);
    if (light < Math.max(110, brightCutoff * 0.8) || contrast < 10 || chroma < 110 || haloChroma < 18) return [];
    return [{ x, y, feature, score: contrast * 2 + chroma * 0.3 + light * 0.05 }];
  }).sort((left, right) => right.score - left.score);

  // ponytail: compact bright spots are only a reviewable proxy for depicted lamps, fire, and magic.
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    if (selected.some((light) => Math.hypot(light.x - candidate.x, light.y - candidate.y) < 8)) continue;
    selected.push(candidate);
    if (selected.length === 20) break;
  }

  return selected.map(({ x, y, feature, score }) => {
    const point = artworkPointToMap({ x: x + 0.5, y: y + 0.5 }, columns, rows, map, grid);
    return {
      ...point,
      range: 6,
      intensity: clamp(0.6 + score / 220, 0.6, 1),
      color: rgbHex(feature),
    };
  });
}

function luminanceFor(feature: CellFeature): number {
  return feature[0] * 0.2126 + feature[1] * 0.7152 + feature[2] * 0.0722;
}

function rgbHex(feature: CellFeature): string {
  return `#${feature.slice(0, 3).map((value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}

function sampleLightCell(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  grid: GridCalibration,
): CellFeature {
  const left = clamp(Math.floor((grid.offsetX + x * grid.cellWidth) * width), 0, width - 1);
  const right = clamp(Math.ceil((grid.offsetX + (x + 1) * grid.cellWidth) * width), left + 1, width);
  const top = clamp(Math.floor((grid.offsetY + y * grid.cellHeight) * height), 0, height - 1);
  const bottom = clamp(Math.ceil((grid.offsetY + (y + 1) * grid.cellHeight) * height), top + 1, height);
  const xStep = Math.max(1, Math.floor((right - left) / 6));
  const yStep = Math.max(1, Math.floor((bottom - top) / 6));
  let best: CellFeature = [0, 0, 0, 0];
  let bestScore = -1;
  for (let py = top; py < bottom; py += yStep) {
    for (let px = left; px < right; px += xStep) {
      const index = (py * width + px) * 4;
      const feature: CellFeature = [pixels[index], pixels[index + 1], pixels[index + 2], 0];
      const chroma = Math.max(feature[0], feature[1], feature[2]) - Math.min(feature[0], feature[1], feature[2]);
      const score = luminanceFor(feature) + chroma * 0.7;
      if (score > bestScore) {
        best = feature;
        bestScore = score;
      }
    }
  }
  return best;
}

function artworkPointToMap(
  point: GridPoint,
  artworkColumns: number,
  artworkRows: number,
  map: Pick<BattleMap, "columns" | "rows">,
  grid: GridCalibration,
): GridPoint {
  return {
    x: clamp((point.x / artworkColumns - grid.offsetX) / grid.cellWidth, 0, map.columns),
    y: clamp((point.y / artworkRows - grid.offsetY) / grid.cellHeight, 0, map.rows),
  };
}

function blockingSegments(
  barriers: SightBarrier[],
  columns: number,
  rows: number,
): Segment[] {
  return [
    ...barriers
      .filter((barrier) => !(barrier.kind === "door" && barrier.open))
      .map(({ start, end }) => ({ start, end })),
    { start: { x: 0, y: 0 }, end: { x: columns, y: 0 } },
    { start: { x: columns, y: 0 }, end: { x: columns, y: rows } },
    { start: { x: columns, y: rows }, end: { x: 0, y: rows } },
    { start: { x: 0, y: rows }, end: { x: 0, y: 0 } },
  ];
}

function castRay(
  origin: GridPoint,
  angle: number,
  range: number,
  segments: Segment[],
): GridPoint {
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  let distance = range;
  for (const segment of segments) {
    const hit = raySegmentDistance(origin, direction, segment);
    if (hit !== null && hit < distance) distance = hit;
  }
  return {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
  };
}

function raySegmentDistance(
  origin: GridPoint,
  direction: GridPoint,
  segment: Segment,
): number | null {
  const wall = {
    x: segment.end.x - segment.start.x,
    y: segment.end.y - segment.start.y,
  };
  const denominator = cross(direction, wall);
  if (Math.abs(denominator) < 1e-9) return null;
  const offset = {
    x: segment.start.x - origin.x,
    y: segment.start.y - origin.y,
  };
  const distance = cross(offset, wall) / denominator;
  const alongWall = cross(offset, direction) / denominator;
  return distance >= 0 && alongWall >= 0 && alongWall <= 1 ? distance : null;
}

function segmentsIntersect(a: GridPoint, b: GridPoint, c: GridPoint, d: GridPoint): boolean {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const cd = { x: d.x - c.x, y: d.y - c.y };
  const denominator = cross(ab, cd);
  if (Math.abs(denominator) < 1e-9) return false;
  const ac = { x: c.x - a.x, y: c.y - a.y };
  const alongAB = cross(ac, cd) / denominator;
  const alongCD = cross(ac, ab) / denominator;
  return alongAB > 0.0001 && alongAB < 0.9999 && alongCD > 0.0001 && alongCD < 0.9999;
}

function cross(left: GridPoint, right: GridPoint): number {
  return left.x * right.y - left.y * right.x;
}

function sampleCell(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  grid: GridCalibration,
): CellFeature {
  const left = clamp(Math.floor((grid.offsetX + (x + 0.25) * grid.cellWidth) * width), 0, width - 1);
  const right = clamp(Math.ceil((grid.offsetX + (x + 0.75) * grid.cellWidth) * width), left + 1, width);
  const top = clamp(Math.floor((grid.offsetY + (y + 0.25) * grid.cellHeight) * height), 0, height - 1);
  const bottom = clamp(Math.ceil((grid.offsetY + (y + 0.75) * grid.cellHeight) * height), top + 1, height);
  let red = 0;
  let green = 0;
  let blue = 0;
  let luminance = 0;
  let luminanceSquared = 0;
  let samples = 0;
  const xStep = Math.max(1, Math.floor((right - left) / 4));
  const yStep = Math.max(1, Math.floor((bottom - top) / 4));
  for (let py = top; py < bottom; py += yStep) {
    for (let px = left; px < right; px += xStep) {
      const index = (py * width + px) * 4;
      red += pixels[index];
      green += pixels[index + 1];
      blue += pixels[index + 2];
      const light = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
      luminance += light;
      luminanceSquared += light * light;
      samples += 1;
    }
  }
  const averageLight = luminance / samples;
  const texture = Math.sqrt(Math.max(0, luminanceSquared / samples - averageLight * averageLight));
  return [red / samples, green / samples, blue / samples, texture * 1.5];
}

function clusterCells(features: CellFeature[], clusterCount: number): number[] {
  if (!features.length) return [];
  const average = averageFeature(features);
  const centroids: CellFeature[] = [features.reduce((closest, feature) =>
    featureDistance(feature, average) < featureDistance(closest, average) ? feature : closest,
  )];
  while (centroids.length < clusterCount) {
    const furthest = features.reduce((candidate, feature) =>
      nearestDistance(feature, centroids) > nearestDistance(candidate, centroids) ? feature : candidate,
    );
    if (nearestDistance(furthest, centroids) < 1) break;
    centroids.push(furthest);
  }

  let assignments = features.map(() => 0);
  for (let pass = 0; pass < 10; pass += 1) {
    assignments = features.map((feature) => nearestCentroid(feature, centroids));
    for (let cluster = 0; cluster < centroids.length; cluster += 1) {
      const members = features.filter((_, index) => assignments[index] === cluster);
      if (members.length) centroids[cluster] = averageFeature(members);
    }
  }
  return assignments;
}

function chooseFloorCluster(features: CellFeature[], assignments: number[]): number | null {
  const clusters = [...new Set(assignments)];
  if (!clusters.length) return null;
  return clusters.reduce((best, cluster) => {
    const members = features.filter((_, index) => assignments[index] === cluster);
    const centroid = averageFeature(members);
    return floorScore(centroid, members.length) > floorScoreForCluster(best, features, assignments)
      ? cluster
      : best;
  }, clusters[0]);
}

function floorScoreForCluster(
  cluster: number,
  features: CellFeature[],
  assignments: number[],
): number {
  const members = features.filter((_, index) => assignments[index] === cluster);
  return floorScore(averageFeature(members), members.length);
}

function featureForCluster(
  cluster: number,
  features: CellFeature[],
  assignments: number[],
): CellFeature {
  return averageFeature(features.filter((_, index) => assignments[index] === cluster));
}

function floorScore(feature: CellFeature, count: number): number {
  const luminance = feature[0] * 0.2126 + feature[1] * 0.7152 + feature[2] * 0.0722;
  const chroma = Math.max(feature[0], feature[1], feature[2]) - Math.min(feature[0], feature[1], feature[2]);
  const nearlyBlackPenalty = luminance < 12 ? 0.1 : 1;
  return count * (0.2 + Math.min(1, luminance / 100)) * (1 + chroma / 90) * nearlyBlackPenalty;
}

function averageFeature(features: CellFeature[]): CellFeature {
  return [0, 1, 2, 3].map((dimension) =>
    features.reduce((sum, feature) => sum + feature[dimension], 0) / features.length,
  ) as CellFeature;
}

function nearestCentroid(feature: CellFeature, centroids: CellFeature[]): number {
  return centroids.reduce((best, centroid, index) =>
    featureDistance(feature, centroid) < featureDistance(feature, centroids[best]) ? index : best,
  0);
}

function nearestDistance(feature: CellFeature, centroids: CellFeature[]): number {
  return Math.min(...centroids.map((centroid) => featureDistance(feature, centroid)));
}

function featureDistance(left: CellFeature, right: CellFeature): number {
  return Math.hypot(...left.map((value, index) => value - right[index]));
}

function cleanFloorMask(mask: boolean[], columns: number, rows: number): boolean[] {
  const cleaned = [...mask];
  const floorComponents = components(cleaned, true, columns, rows);
  const largestFloor = Math.max(0, ...floorComponents.map((component) => component.length));
  const minimumFloor = Math.max(4, Math.floor(largestFloor * 0.08));
  for (const component of floorComponents) {
    if (component.length < minimumFloor) {
      for (const cell of component) cleaned[cell] = false;
    }
  }

  const maximumHole = Math.max(4, Math.floor(columns * rows * 0.012));
  for (const hole of components(cleaned, false, columns, rows)) {
    const touchesEdge = hole.some((cell) => {
      const x = cell % columns;
      const y = Math.floor(cell / columns);
      return x === 0 || y === 0 || x === columns - 1 || y === rows - 1;
    });
    if (!touchesEdge && hole.length <= maximumHole) {
      for (const cell of hole) cleaned[cell] = true;
    }
  }
  return cleaned;
}

function components(
  mask: boolean[],
  target: boolean,
  columns: number,
  rows: number,
): number[][] {
  const seen = new Set<number>();
  const found: number[][] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (seen.has(start) || mask[start] !== target) continue;
    const component: number[] = [];
    const queue = [start];
    seen.add(start);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const cell = queue[cursor];
      component.push(cell);
      const x = cell % columns;
      const y = Math.floor(cell / columns);
      for (const neighbor of [
        x > 0 ? cell - 1 : -1,
        x < columns - 1 ? cell + 1 : -1,
        y > 0 ? cell - columns : -1,
        y < rows - 1 ? cell + columns : -1,
      ]) {
        if (neighbor >= 0 && !seen.has(neighbor) && mask[neighbor] === target) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    found.push(component);
  }
  return found;
}

function mergeSegments(
  candidates: Array<Segment & { axis: "vertical" | "horizontal" }>,
): Segment[] {
  const vertical = new Map<number, number[]>();
  const horizontal = new Map<number, number[]>();
  for (const candidate of candidates) {
    const groups = candidate.axis === "vertical" ? vertical : horizontal;
    const fixed = candidate.axis === "vertical" ? candidate.start.x : candidate.start.y;
    const moving = candidate.axis === "vertical" ? candidate.start.y : candidate.start.x;
    groups.set(fixed, [...(groups.get(fixed) ?? []), moving]);
  }

  const merged: Segment[] = [];
  for (const [x, values] of vertical) {
    for (const [start, end] of contiguousRanges(values)) {
      merged.push({ start: { x, y: start }, end: { x, y: end + 1 } });
    }
  }
  for (const [y, values] of horizontal) {
    for (const [start, end] of contiguousRanges(values)) {
      merged.push({ start: { x: start, y }, end: { x: end + 1, y } });
    }
  }
  return merged;
}

function contiguousRanges(values: number[]): Array<[number, number]> {
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  const ranges: Array<[number, number]> = [];
  for (const value of sorted) {
    const last = ranges.at(-1);
    if (last && value === last[1] + 1) last[1] = value;
    else ranges.push([value, value]);
  }
  return ranges;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
