import type {
  GridCalibration,
  GridPoint,
  MapLighting,
  SightBarrier,
} from "@/lib/room-state";

type RawPoint = { x?: unknown; y?: unknown };

export type UvttImport = {
  columns: number;
  rows: number;
  imageBase64: string;
  imageType: "image/png" | "image/jpeg" | "image/webp";
  grid: GridCalibration;
  lighting: MapLighting;
};

export function parseUvtt(source: string): UvttImport {
  const raw = JSON.parse(source) as Record<string, unknown>;
  const resolution = requiredObject(raw.resolution, "UVTT resolution");
  const mapSize = requiredObject(resolution.map_size, "UVTT map size");
  const origin = pointFrom(resolution.map_origin, { x: 0, y: 0 });
  const columns = integer(mapSize.x, "UVTT map width");
  const rows = integer(mapSize.y, "UVTT map height");
  if (columns < 4 || columns > 100 || rows < 4 || rows > 100) {
    throw new Error("UVTT maps must be between 4 and 100 squares in each direction.");
  }

  const barriers: SightBarrier[] = [];
  let barrierNumber = 0;
  for (const paths of [raw.line_of_sight, raw.objects_line_of_sight]) {
    if (!Array.isArray(paths)) continue;
    for (const path of paths) {
      if (!Array.isArray(path)) continue;
      const points = path.map((value) => translatedPoint(value, origin, columns, rows));
      for (let index = 1; index < points.length; index += 1) {
        barrierNumber += 1;
        barriers.push({
          id: `uvtt-wall-${String(barrierNumber).padStart(4, "0")}`,
          start: points[index - 1],
          end: points[index],
          kind: "wall",
          open: false,
        });
      }
    }
  }

  if (Array.isArray(raw.portals)) {
    for (const value of raw.portals) {
      if (!value || typeof value !== "object") continue;
      const portal = value as Record<string, unknown>;
      if (!Array.isArray(portal.bounds) || portal.bounds.length < 2) continue;
      barrierNumber += 1;
      barriers.push({
        id: `uvtt-door-${String(barrierNumber).padStart(4, "0")}`,
        start: translatedPoint(portal.bounds[0], origin, columns, rows),
        end: translatedPoint(portal.bounds[1], origin, columns, rows),
        kind: "door",
        open: portal.closed !== true,
      });
    }
  }

  const lights = Array.isArray(raw.lights)
    ? raw.lights.flatMap((value, index) => {
        if (!value || typeof value !== "object") return [];
        const light = value as Record<string, unknown>;
        const position = translatedPoint(light.position, origin, columns, rows);
        return [{
          id: `uvtt-light-${String(index + 1).padStart(4, "0")}`,
          x: position.x,
          y: position.y,
          range: finite(light.range, 6),
          intensity: clamp(finite(light.intensity, 0.7), 0, 1),
          color: validColor(light.color) ? light.color : "#ffd58a",
        }];
      })
    : [];

  const environment = raw.environment && typeof raw.environment === "object"
    ? raw.environment as Record<string, unknown>
    : {};
  const image = imageData(raw.image);
  return {
    columns,
    rows,
    ...image,
    grid: {
      offsetX: 0,
      offsetY: 0,
      cellWidth: 1 / columns,
      cellHeight: 1 / rows,
      imageAspect: columns / rows,
    },
    lighting: {
      enabled: true,
      darkness: ambientDarkness(environment.ambient_light),
      barriers,
      lights,
      explored: {},
    },
  };
}

function imageData(value: unknown): Pick<UvttImport, "imageBase64" | "imageType"> {
  if (typeof value !== "string" || !value.trim()) throw new Error("UVTT image data is missing.");
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/);
  const imageType = (match?.[1] ?? "image/png") as UvttImport["imageType"];
  const imageBase64 = (match?.[2] ?? value).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) throw new Error("UVTT image data is invalid.");
  return { imageBase64, imageType };
}

function translatedPoint(
  value: unknown,
  origin: GridPoint,
  columns: number,
  rows: number,
): GridPoint {
  const point = pointFrom(value, origin);
  return {
    x: clamp(point.x - origin.x, 0, columns),
    y: clamp(point.y - origin.y, 0, rows),
  };
}

function pointFrom(value: unknown, fallback: GridPoint): GridPoint {
  if (!value || typeof value !== "object") return fallback;
  const point = value as RawPoint;
  return {
    x: finite(point.x, fallback.x),
    y: finite(point.y, fallback.y),
  };
}

function requiredObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error(`${label} is missing.`);
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
  const number = Math.round(finite(value, Number.NaN));
  if (!Number.isFinite(number)) throw new Error(`${label} is invalid.`);
  return number;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function validColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function ambientDarkness(value: unknown): number {
  if (!validColor(value)) return 0.92;
  const red = Number.parseInt(value.slice(1, 3), 16);
  const green = Number.parseInt(value.slice(3, 5), 16);
  const blue = Number.parseInt(value.slice(5, 7), 16);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return clamp(1 - luminance / 255, 0.15, 0.98);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
