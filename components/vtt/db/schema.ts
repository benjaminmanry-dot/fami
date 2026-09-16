import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dmKeyHash: text("dm_key_hash").notNull(),
  stateJson: text("state_json").notNull(),
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const roomHistory = sqliteTable("room_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: text("room_id").notNull(),
  direction: text("direction", { enum: ["undo", "redo"] }).notNull(),
  stateJson: text("state_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("room_history_room_direction_id_idx").on(table.roomId, table.direction, table.id),
]);

export const roomMediaUsage = sqliteTable("room_media_usage", {
  roomId: text("room_id").primaryKey(),
  uploadCount: integer("upload_count").notNull().default(0),
  byteCount: integer("byte_count").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
