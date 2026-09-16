export const roomCodeCharacters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const publicRoomCodeLength = 10;
export const maximumMapBytes = 20 * 1024 * 1024;
export const maximumTokenBytes = 5 * 1024 * 1024;
export const maximumRoomMediaBytes = 512 * 1024 * 1024;
export const maximumRoomMediaUploads = 1_000;

export class RequestBodyTooLarge extends Error {}

const publicRoomPattern = /^[A-HJ-NP-Z2-9]{10}$/;
const legacyRoomPattern = /^[A-HJ-NP-Z2-9]{6}$/;
const mediaKeyPattern = /^(?:[A-HJ-NP-Z2-9]{6}|[A-HJ-NP-Z2-9]{10})\/(?:map|token)\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/;

export function normalizedRoomCode(value: unknown, allowLegacy = false): string | null {
  const roomId = typeof value === "string" ? value.trim().toUpperCase() : "";
  return publicRoomPattern.test(roomId) || (allowLegacy && legacyRoomPattern.test(roomId))
    ? roomId
    : null;
}

export function randomRoomCode(
  bytes = crypto.getRandomValues(new Uint8Array(publicRoomCodeLength)),
): string {
  if (bytes.length !== publicRoomCodeLength) {
    throw new Error(`Room codes require ${publicRoomCodeLength} random bytes.`);
  }
  return Array.from(
    bytes,
    (byte) => roomCodeCharacters[byte % roomCodeCharacters.length],
  ).join("");
}

export function isSiteOwner(
  headers: Pick<Headers, "get">,
  configuredUserId: unknown,
  localDevelopment = false,
): boolean {
  const host = headers.get("host")?.toLowerCase() ?? "";
  if (
    localDevelopment &&
    (host === "localhost" || host.startsWith("localhost:") ||
      host === "127.0.0.1" || host.startsWith("127.0.0.1:"))
  ) return true;
  const expected = typeof configuredUserId === "string" ? configuredUserId.trim() : "";
  return Boolean(expected) && headers.get("oai-authenticated-user-id") === expected;
}

export function isMediaKey(value: unknown): value is string {
  return typeof value === "string" && mediaKeyPattern.test(value);
}

export function isMediaKeyFor(
  value: unknown,
  roomId: string,
  kind: "map" | "token",
): value is string {
  return isMediaKey(value) && value.startsWith(`${roomId}/${kind}/`);
}

export type ImageExtension = "png" | "jpg" | "webp";

export function verifiedImageExtension(
  contentType: string,
  bytes: Uint8Array,
): ImageExtension | null {
  if (
    contentType === "image/png" && bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((byte, index) => bytes[index] === byte)
  ) return "png";
  if (
    contentType === "image/jpeg" && bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  ) return "jpg";
  if (
    contentType === "image/webp" && bytes.length >= 12 &&
    new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
  ) return "webp";
  return null;
}

export async function readRequestBytes(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? Number.NaN);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RequestBodyTooLarge();
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new RequestBodyTooLarge();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
