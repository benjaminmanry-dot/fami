import {
  ensureRoomsTable,
  getConfiguredOwnerUserId,
  getDatabase,
  getMediaBucket,
  isLocalDevelopment,
} from "@/db";
import {
  isMediaKey,
  isSiteOwner,
  maximumMapBytes,
  maximumRoomMediaBytes,
  maximumRoomMediaUploads,
  maximumTokenBytes,
  normalizedRoomCode,
  readRequestBytes,
  RequestBodyTooLarge,
  verifiedImageExtension,
} from "@/lib/public-access";
import { isValidClientId, parseRoomState, RoomStateError } from "@/lib/room-state";

type RoomRow = {
  dm_key_hash: string;
  state_json: string;
};

export async function GET(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!isMediaKey(key)) return jsonError("Invalid image key.", 400);
    const object = await getMediaBucket().get(key);
    if (!object) return jsonError("Image not found.", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        ETag: object.httpEtag,
      },
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const owner = isSiteOwner(
      request.headers,
      getConfiguredOwnerUserId(),
      isLocalDevelopment(),
    );
    const roomId = normalizedRoomCode(request.headers.get("X-VTT-Room"), owner);
    const clientId = request.headers.get("X-VTT-Client");
    const dmKey = request.headers.get("X-VTT-DM-Key") ?? "";
    const kind = request.headers.get("X-VTT-Kind");
    const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim() ?? "";

    if (!roomId || !isValidClientId(clientId)) {
      throw new RoomStateError("A valid room and player session are required.");
    }
    if (kind !== "map" && kind !== "token") {
      throw new RoomStateError("Upload type must be map or token.");
    }
    if (!request.body) throw new RoomStateError("Choose an image to upload.");

    const maximumBytes = kind === "map" ? maximumMapBytes : maximumTokenBytes;
    const declaredLength = Number(request.headers.get("Content-Length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && (declaredLength <= 0 || declaredLength > maximumBytes)) {
      throw uploadSizeError(kind);
    }

    const database = getDatabase();
    await ensureRoomsTable(database);
    const room = await database
      .prepare("SELECT dm_key_hash, state_json FROM rooms WHERE id = ?")
      .bind(roomId)
      .first<RoomRow>();
    if (!room) throw new RoomStateError("Room not found.", 404);

    const isDm = owner && Boolean(dmKey) && (await hashSecret(dmKey)) === room.dm_key_hash;
    if (kind === "map" && !isDm) {
      throw new RoomStateError("Only the Site owner can upload maps.", 403);
    }
    if (
      kind === "token" && !isDm &&
      !parseRoomState(room.state_json).players?.some((player) =>
        player.id === clientId && player.isDm === false,
      )
    ) {
      throw new RoomStateError("Join the room before uploading a token.", 403);
    }

    let bytes: Uint8Array;
    try {
      bytes = await readRequestBytes(request, maximumBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLarge) throw uploadSizeError(kind);
      throw error;
    }
    if (bytes.byteLength <= 0) throw uploadSizeError(kind);
    const extension = verifiedImageExtension(contentType, bytes);
    if (!extension) {
      throw new RoomStateError("Upload a real PNG, JPEG, or WebP image with the matching file type.");
    }

    await reserveMediaUpload(database, roomId, bytes.byteLength);
    const key = `${roomId}/${kind}/${crypto.randomUUID()}.${extension}`;
    await getMediaBucket().put(key, bytes, {
      httpMetadata: {
        contentType,
        cacheControl: "private, max-age=31536000, immutable",
      },
    });
    return Response.json(
      { key, url: `/api/media?key=${encodeURIComponent(key)}` },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}

async function reserveMediaUpload(
  database: D1Database,
  roomId: string,
  byteCount: number,
): Promise<void> {
  const result = await database.prepare(
    `INSERT INTO room_media_usage (room_id, upload_count, byte_count)
     VALUES (?, 1, ?)
     ON CONFLICT(room_id) DO UPDATE SET
       upload_count = upload_count + 1,
       byte_count = byte_count + excluded.byte_count,
       updated_at = CURRENT_TIMESTAMP
     WHERE upload_count < ? AND byte_count + excluded.byte_count <= ?`,
  ).bind(
    roomId,
    byteCount,
    maximumRoomMediaUploads,
    maximumRoomMediaBytes,
  ).run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new RoomStateError("This room has reached its upload allowance.", 429);
  }
}

function uploadSizeError(kind: "map" | "token") {
  return new RoomStateError(
    kind === "map" ? "Map images must be 20 MB or smaller." : "Token images must be 5 MB or smaller.",
    413,
  );
}

async function hashSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function routeError(error: unknown) {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status: unknown }).status)
      : 500;
  const message = error instanceof Error ? error.message : "Unexpected error";
  return jsonError(message, status >= 400 && status <= 599 ? status : 500);
}

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
