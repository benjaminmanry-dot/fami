import {
  ensureRoomsTable,
  getConfiguredOwnerUserId,
  getDatabase,
  isLocalDevelopment,
} from "@/db";
import {
  applyRoomOperation,
  createInitialRoomState,
  isValidClientId,
  isUndoableRoomOperation,
  parseRoomState,
  type RoomActor,
  RoomStateError,
} from "@/lib/room-state";
import { roomStateForActor } from "@/lib/room-view";
import {
  isSiteOwner,
  normalizedRoomCode,
  publicRoomCodeLength,
  randomRoomCode,
  readRequestBytes,
  RequestBodyTooLarge,
} from "@/lib/public-access";

type RoomRow = {
  id: string;
  name: string;
  dm_key_hash: string;
  state_json: string;
  revision: number;
};

type HistoryEntry = {
  id: number;
  state_json: string;
};

type HistoryAvailability = {
  canUndo: boolean;
  canRedo: boolean;
};

const maximumRoomRequestBytes = 12_500_000;
const maximumPlayerRequestBytes = 750_000;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const owner = requestIsFromOwner(request);
    const roomId = normalizeRoomId(url.searchParams.get("id"), owner);
    const sinceValue = url.searchParams.get("since");
    const since = sinceValue === null ? Number.NaN : Number(sinceValue);
    const clientId = request.headers.get("X-VTT-Client");
    if (!isValidClientId(clientId)) {
      throw new RoomStateError("A valid player session is required.");
    }
    const database = getDatabase();
    await ensureRoomsTable(database);
    const room = await readRoom(database, roomId);
    if (!room) return jsonError("Room not found.", 404);

    if (Number.isInteger(since) && since === room.revision) {
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const actor = await roomActor(
      room,
      roomId,
      clientId,
      request.headers.get("X-VTT-DM-Key") ?? "",
      owner,
    );
    return snapshotResponse(database, room.id, room.revision, parseRoomState(room.state_json), actor);
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const owner = requestIsFromOwner(request);
    const payload = await roomRequestPayload(
      request,
      owner ? maximumRoomRequestBytes : maximumPlayerRequestBytes,
    );
    if (payload.action === "create") {
      if (!owner) throw new RoomStateError("Only the Site owner can create rooms.", 403);
      return await createRoom(payload.name);
    }
    if (payload.action === "mutate") {
      return await mutateRoom(
        payload,
        request.headers.get("X-VTT-DM-Key") ?? "",
        owner,
      );
    }
    return jsonError("Unsupported room action.", 400);
  } catch (error) {
    return routeError(error);
  }
}

async function createRoom(rawName: unknown) {
  const name =
    typeof rawName === "string" && rawName.trim()
      ? rawName.trim().slice(0, 60)
      : "Game room";
  const database = getDatabase();
  await ensureRoomsTable(database);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const roomId = randomRoomCode();
    const dmKey = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
      "-",
      "",
    );
    const dmKeyHash = await hashSecret(dmKey);
    const state = createInitialRoomState(name);
    const result = await database
      .prepare(
        `INSERT OR IGNORE INTO rooms
         (id, name, dm_key_hash, state_json, revision)
         VALUES (?, ?, ?, ?, 0)`,
      )
      .bind(roomId, state.name, dmKeyHash, JSON.stringify(state))
      .run();

    if ((result.meta.changes ?? 0) === 1) {
      return Response.json(
        { roomId, dmKey, revision: 0, state, canUndo: false, canRedo: false, isDm: true },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  return jsonError("Could not create a unique room. Please try again.", 503);
}

async function mutateRoom(
  payload: Record<string, unknown>,
  dmKey: string,
  owner: boolean,
) {
  const roomId = normalizeRoomId(payload.roomId, owner);
  const clientId = payload.clientId;
  if (!isValidClientId(clientId)) {
    throw new RoomStateError("A valid player session is required.");
  }
  const database = getDatabase();
  await ensureRoomsTable(database);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const room = await readRoom(database, roomId);
    if (!room) throw new RoomStateError("Room not found.", 404);
    const actor = await roomActor(room, roomId, clientId, dmKey, owner);
    const operationType = operationName(payload.operation);
    if (operationType === "undo-room" || operationType === "redo-room") {
      if (!actor.isDm) throw new RoomStateError("Only the DM can do that.", 403);
      const restored = await restoreHistory(
        database,
        room,
        operationType === "undo-room" ? "undo" : "redo",
      );
      if (!restored) continue;
      return snapshotResponse(database, roomId, room.revision + 1, restored, actor);
    }

    const state = parseRoomState(room.state_json);
    const next = applyRoomOperation(state, payload.operation, actor);
    if (await persistRoomMutation(
      database,
      room,
      next,
      isUndoableRoomOperation(payload.operation),
    )) {
      return snapshotResponse(database, roomId, room.revision + 1, next, actor);
    }
  }

  return jsonError("The table changed too quickly. Please try again.", 409);
}

async function readRoom(
  database: D1Database,
  roomId: string,
): Promise<RoomRow | null> {
  return database
    .prepare(
      `SELECT id, name, dm_key_hash, state_json, revision
       FROM rooms WHERE id = ?`,
    )
    .bind(roomId)
    .first<RoomRow>();
}

async function roomActor(
  room: RoomRow,
  roomId: string,
  clientId: string,
  dmKey: string,
  owner: boolean,
): Promise<RoomActor> {
  return {
    roomId,
    clientId,
    isDm: owner && Boolean(dmKey) && (await hashSecret(dmKey)) === room.dm_key_hash,
  };
}

function operationName(operation: unknown): string {
  return operation && typeof operation === "object"
    ? String((operation as Record<string, unknown>).type ?? "")
    : "";
}

async function persistRoomMutation(
  database: D1Database,
  room: RoomRow,
  state: ReturnType<typeof parseRoomState>,
  remember: boolean,
): Promise<boolean> {
  const serialized = JSON.stringify(state);
  const update = database
    .prepare(
      `UPDATE rooms
       SET name = ?, state_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND revision = ?`,
    )
    .bind(state.name, serialized, room.id, room.revision);
  if (!remember) {
    const result = await update.run();
    return (result.meta.changes ?? 0) === 1;
  }

  // ponytail: full snapshots are the smallest reliable shared undo; use patches only if real room sizes make this expensive.
  const results = await database.batch([
    update,
    database
      .prepare(
        `INSERT INTO room_history (room_id, direction, state_json)
         SELECT ?, 'undo', ? WHERE EXISTS (
           SELECT 1 FROM rooms WHERE id = ? AND revision = ? AND state_json = ?
         )`,
      )
      .bind(room.id, room.state_json, room.id, room.revision + 1, serialized),
    database
      .prepare(
        `DELETE FROM room_history
         WHERE room_id = ? AND direction = 'redo' AND EXISTS (
           SELECT 1 FROM rooms WHERE id = ? AND revision = ? AND state_json = ?
         )`,
      )
      .bind(room.id, room.id, room.revision + 1, serialized),
    database
      .prepare(
        `DELETE FROM room_history
         WHERE room_id = ? AND direction = 'undo' AND id NOT IN (
           SELECT id FROM room_history
           WHERE room_id = ? AND direction = 'undo'
           ORDER BY id DESC LIMIT 20
         )`,
      )
      .bind(room.id, room.id),
  ]);
  return (results[0].meta.changes ?? 0) === 1;
}

async function restoreHistory(
  database: D1Database,
  room: RoomRow,
  direction: "undo" | "redo",
): Promise<ReturnType<typeof parseRoomState> | null> {
  const entry = await database
    .prepare(
      `SELECT id, state_json FROM room_history
       WHERE room_id = ? AND direction = ? ORDER BY id DESC LIMIT 1`,
    )
    .bind(room.id, direction)
    .first<HistoryEntry>();
  if (!entry) {
    throw new RoomStateError(direction === "undo" ? "Nothing to undo." : "Nothing to redo.", 409);
  }
  const state = parseRoomState(entry.state_json);
  const serialized = JSON.stringify(state);
  const opposite = direction === "undo" ? "redo" : "undo";
  const results = await database.batch([
    database
      .prepare(
        `UPDATE rooms
         SET name = ?, state_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND revision = ?`,
      )
      .bind(state.name, serialized, room.id, room.revision),
    database
      .prepare(
        `INSERT INTO room_history (room_id, direction, state_json)
         SELECT ?, ?, ? WHERE EXISTS (
           SELECT 1 FROM rooms WHERE id = ? AND revision = ? AND state_json = ?
         )`,
      )
      .bind(room.id, opposite, room.state_json, room.id, room.revision + 1, serialized),
    database
      .prepare(
        `DELETE FROM room_history
         WHERE id = ? AND room_id = ? AND EXISTS (
           SELECT 1 FROM rooms WHERE id = ? AND revision = ? AND state_json = ?
         )`,
      )
      .bind(entry.id, room.id, room.id, room.revision + 1, serialized),
    database
      .prepare(
        `DELETE FROM room_history
         WHERE room_id = ? AND direction = ? AND id NOT IN (
           SELECT id FROM room_history
           WHERE room_id = ? AND direction = ?
           ORDER BY id DESC LIMIT 20
         )`,
      )
      .bind(room.id, opposite, room.id, opposite),
  ]);
  return (results[0].meta.changes ?? 0) === 1 ? state : null;
}

async function historyAvailability(
  database: D1Database,
  roomId: string,
): Promise<HistoryAvailability> {
  const row = await database
    .prepare(
      `SELECT
         EXISTS(SELECT 1 FROM room_history WHERE room_id = ? AND direction = 'undo') AS can_undo,
         EXISTS(SELECT 1 FROM room_history WHERE room_id = ? AND direction = 'redo') AS can_redo`,
    )
    .bind(roomId, roomId)
    .first<{ can_undo: number; can_redo: number }>();
  return { canUndo: row?.can_undo === 1, canRedo: row?.can_redo === 1 };
}

async function snapshotResponse(
  database: D1Database,
  roomId: string,
  revision: number,
  state: ReturnType<typeof parseRoomState>,
  actor: RoomActor,
): Promise<Response> {
  const history = actor.isDm
    ? await historyAvailability(database, roomId)
    : { canUndo: false, canRedo: false };
  return Response.json(
    {
      roomId,
      revision,
      state: roomStateForActor(state, actor),
      ...history,
      isDm: actor.isDm,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function normalizeRoomId(value: unknown, allowLegacy: boolean): string {
  const roomId = normalizedRoomCode(value, allowLegacy);
  if (!roomId) {
    throw new RoomStateError(`Enter a valid ${publicRoomCodeLength}-character room code.`);
  }
  return roomId;
}

function requestIsFromOwner(request: Request): boolean {
  return isSiteOwner(
    request.headers,
    getConfiguredOwnerUserId(),
    isLocalDevelopment(),
  );
}

async function roomRequestPayload(
  request: Request,
  maximumBytes: number,
): Promise<Record<string, unknown>> {
  let bytes: Uint8Array;
  try {
    bytes = await readRequestBytes(request, maximumBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) {
      throw new RoomStateError("That tabletop request is too large.", 413);
    }
    throw error;
  }
  if (bytes.byteLength <= 0) throw new RoomStateError("That tabletop request is empty.");
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new RoomStateError("Send a valid tabletop request.");
  }
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
  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : "Unexpected error";
  return jsonError(message, status);
}

function errorStatus(error: unknown): number {
  if (!error || typeof error !== "object" || !("status" in error)) return 500;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 400 && status <= 599
    ? status
    : 500;
}

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
