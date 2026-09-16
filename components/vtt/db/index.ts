import { env } from "cloudflare:workers";

type AppBindings = {
  DB?: D1Database;
  MEDIA?: R2Bucket;
  VTT_OWNER_USER_ID?: string;
  VTT_LOCAL_DEVELOPMENT?: string;
};

function bindings(): AppBindings {
  return env as unknown as AppBindings;
}

export function getDatabase(): D1Database {
  const database = bindings().DB;
  if (!database) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return database;
}

export function getMediaBucket(): R2Bucket {
  const bucket = bindings().MEDIA;
  if (!bucket) {
    throw new Error(
      "Cloudflare R2 binding `MEDIA` is unavailable. Set the `r2` field in .openai/hosting.json to `MEDIA` before using uploads."
    );
  }

  return bucket;
}

export function getConfiguredOwnerUserId(): string {
  return bindings().VTT_OWNER_USER_ID?.trim() ?? "";
}

export function isLocalDevelopment(): boolean {
  return bindings().VTT_LOCAL_DEVELOPMENT === "true";
}

export async function ensureRoomsTable(database: D1Database): Promise<void> {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dm_key_hash TEXT NOT NULL,
      state_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS room_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('undo', 'redo')),
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare(`CREATE INDEX IF NOT EXISTS room_history_room_direction_id_idx
      ON room_history (room_id, direction, id)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS room_media_usage (
      room_id TEXT PRIMARY KEY,
      upload_count INTEGER NOT NULL DEFAULT 0,
      byte_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);
}
