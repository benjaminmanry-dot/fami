import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text().primaryKey(), name: text().notNull(), description: text().notNull(),
  label: text().notNull().default("external"), source: text().notNull().default("direct"),
  suspended: integer().notNull().default(0), removed: integer().notNull().default(0),
  created_at: text().notNull(), last_seen_at: text().notNull(),
}, t => [uniqueIndex("account_name").on(t.name)]);
export const credentials = sqliteTable("credentials", {
  id: text().primaryKey(), account_id: text().notNull().references(()=>accounts.id),
  hash: text().notNull().unique(), name: text().notNull(), revoked: integer().notNull().default(0), created_at: text().notNull(),
});
export const entries = sqliteTable("entries", {
  id: text().primaryKey(), author_id: text().notNull().references(()=>accounts.id),
  kind: text().notNull(), title: text().notNull(), body: text().notNull(), tags: text().notNull(),
  inputs: text().notNull().default(""), limitations: text().notNull().default(""),
  pricing: text().notNull().default("not offered"), evidence: text().notNull().default("[]"),
  source_url: text().notNull().default(""), status: text().notNull().default("open"),
  outcome: text().notNull().default(""), confirmed_by: text(), related_entry_id: text(),
  hidden: integer().notNull().default(0), removed: integer().notNull().default(0),
  created_at: text().notNull(), updated_at: text().notNull(), version: integer().notNull().default(1),
},t=>[index("entry_activity").on(t.updated_at),index("entry_owner").on(t.author_id)]);
export const replies = sqliteTable("replies", {
  id: text().primaryKey(), entry_id: text().notNull().references(()=>entries.id),
  author_id: text().notNull().references(()=>accounts.id), body: text().notNull(),
  kind: text().notNull().default("discussion"), evidence: text().notNull().default("[]"),
  hidden: integer().notNull().default(0), removed: integer().notNull().default(0), created_at: text().notNull(),
},t=>[index("reply_entry").on(t.entry_id)]);
export const follows = sqliteTable("follows", {
  id: text().primaryKey(), account_id: text().notNull().references(()=>accounts.id),
  target: text().notNull(), kind: text().notNull(), created_at: text().notNull(),
},t=>[uniqueIndex("follow_unique").on(t.account_id,t.kind,t.target)]);
export const events = sqliteTable("events", {
  seq: integer().primaryKey({autoIncrement:true}), type: text().notNull(), actor_id: text(),
  entry_id: text(), detail: text().notNull(), created_at: text().notNull(),
},t=>[index("event_entry").on(t.entry_id)]);
export const mutations = sqliteTable("mutations", {
  id: text().primaryKey(), fingerprint: text().notNull(), response: text().notNull(), created_at: text().notNull(),
});
export const limits = sqliteTable("limits", { id: text().primaryKey(), count: integer().notNull(), expires: integer().notNull() });
export const reports = sqliteTable("reports", {
  id: text().primaryKey(), reporter_id: text().notNull(), entry_id: text().notNull(), reply_id: text(),
  reason: text().notNull(), status: text().notNull().default("open"), created_at: text().notNull(),
});
export const settings = sqliteTable("settings", { key: text().primaryKey(), value: text().notNull() });
export const hostCycles = sqliteTable("host_cycles", {
  id: text().primaryKey(), cursor: integer().notNull(), summary: text().notNull(), created_at: text().notNull(),
});
export const introductions = sqliteTable("introductions", {
  id: text().primaryKey(), agent: text().notNull(), channel: text().notNull(), source_url: text().notNull(),
  state: text().notNull(), detail: text().notNull(), updated_at: text().notNull(),
});
