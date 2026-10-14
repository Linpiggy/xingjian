import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { EditSnapshot } from "@/domain/editing";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const expiresAt = () => timestamp("expires_at", { withTimezone: true }).notNull();

// Only digests are stored; ownership still requires server-side session checks.
export const guestSessions = pgTable(
  "trip_guest_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    createdAt: createdAt(),
    expiresAt: expiresAt(),
  },
  (table) => [
    check("trip_guest_token_digest", sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check("trip_guest_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const plans = pgTable(
  "trip_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => guestSessions.id),
    currentVersion: integer("current_version").notNull(),
    timeZone: varchar("time_zone", { length: 32 }).notNull().default("Asia/Shanghai"),
    createdAt: createdAt(),
    expiresAt: expiresAt(),
  },
  (table) => [
    index("trip_plans_owner_idx").on(table.ownerId),
    check("trip_plan_version_nonnegative", sql`${table.currentVersion} >= 0`),
    check("trip_plan_timezone", sql`${table.timeZone} = 'Asia/Shanghai'`),
    check("trip_plan_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

// Snapshot retention must pass source-license checks before insertion.
export const planVersions = pgTable(
  "trip_plan_versions",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    version: integer("version").notNull(),
    restoredFrom: integer("restored_from"),
    snapshot: jsonb("snapshot").$type<EditSnapshot>().notNull(),
    createdAt: createdAt(),
    expiresAt: expiresAt(),
  },
  (table) => [
    primaryKey({ columns: [table.planId, table.version] }),
    check("trip_version_nonnegative", sql`${table.version} >= 0`),
    check(
      "trip_restore_older_version",
      sql`${table.restoredFrom} IS NULL OR (${table.restoredFrom} >= 0 AND ${table.restoredFrom} < ${table.version})`,
    ),
    check("trip_snapshot_object", sql`jsonb_typeof(${table.snapshot}) = 'object'`),
    check("trip_version_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const proposals = pgTable(
  "trip_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planId: uuid("plan_id").notNull(),
    baseVersion: integer("base_version").notNull(),
    operation: jsonb("operation").$type<unknown>().notNull(),
    preview: jsonb("preview").$type<EditSnapshot>().notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
    expiresAt: expiresAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.planId, table.baseVersion],
      foreignColumns: [planVersions.planId, planVersions.version],
      name: "trip_proposal_base_version_fk",
    }),
    check("trip_proposal_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "trip_proposal_operation_object",
      sql`jsonb_typeof(${table.operation}) = 'object'`,
    ),
    check("trip_proposal_preview_object", sql`jsonb_typeof(${table.preview}) = 'object'`),
  ],
);

// Share JSON is deliberately not typed as an editable snapshot. Services must
// construct and validate a separate redacted DTO, never copy a plan verbatim.
export const shares = pgTable(
  "trip_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planId: uuid("plan_id").notNull(),
    version: integer("version").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    snapshot: jsonb("snapshot").$type<unknown>().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
    expiresAt: expiresAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.planId, table.version],
      foreignColumns: [planVersions.planId, planVersions.version],
      name: "trip_share_version_fk",
    }),
    check("trip_share_token_digest", sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check("trip_share_snapshot_object", sql`jsonb_typeof(${table.snapshot}) = 'object'`),
    check("trip_share_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
