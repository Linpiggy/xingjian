import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  guestSessions,
  plans,
  planVersions,
  proposals,
  shares,
} from "@/server/db/schema";

const migration = readFileSync("drizzle/0000_plan_version_foundation.sql", "utf8");
const tables = [guestSessions, plans, planVersions, proposals, shares];
const dialect = new PgDialect();

describe("schema definitions and generated SQL (not PostgreSQL integration)", () => {
  it("stores only unique non-null token digests in separate owner/share tables", () => {
    for (const table of [guestSessions, shares]) {
      const config = getTableConfig(table);
      expect(config.columns.map((column) => column.name)).not.toContain("token");
      expect(table.tokenHash.notNull).toBe(true);
      expect(table.tokenHash.isUnique).toBe(true);
      expect(table.tokenHash.getSQLType()).toBe("varchar(64)");
      const digestCheck = config.checks.find((check) =>
        check.name.endsWith("token_digest"),
      );
      expect(digestCheck).toBeDefined();
      expect(dialect.sqlToQuery(digestCheck!.value).sql).toContain("^[a-f0-9]{64}$");
    }
    expect(getTableName(guestSessions)).not.toBe(getTableName(shares));
    expect(shares.revokedAt.notNull).toBe(false);
    expect(proposals.consumedAt.notNull).toBe(false);
  });

  it("requires explicit bounded expiry and stores database timestamps with time zones", () => {
    for (const table of tables) {
      expect(table.createdAt.getSQLType()).toBe("timestamp with time zone");
      expect(table.expiresAt.getSQLType()).toBe("timestamp with time zone");
      expect(table.expiresAt.notNull).toBe(true);
      expect(table.expiresAt.hasDefault).toBe(false);
      const expiry = getTableConfig(table).checks.find((check) =>
        check.name.endsWith("expiry"),
      );
      expect(expiry).toBeDefined();
      expect(dialect.sqlToQuery(expiry!.value).sql).toContain("expires_at");
    }
    expect(plans.timeZone.default).toBe("Asia/Shanghai");
    expect(migration).toContain("\"time_zone\" = 'Asia/Shanghai'");
  });

  it("keys each version by plan and version, and links proposals/shares to the same pair", () => {
    const versionConfig = getTableConfig(planVersions);
    expect(versionConfig.primaryKeys[0].columns.map((column) => column.name)).toEqual([
      "plan_id",
      "version",
    ]);
    for (const table of [proposals, shares]) {
      const reference = getTableConfig(table).foreignKeys[0].reference();
      expect(getTableName(reference.foreignTable)).toBe("trip_plan_versions");
      expect(reference.foreignColumns.map((column) => column.name)).toEqual([
        "plan_id",
        "version",
      ]);
      expect(reference.columns.map((column) => column.name)).toEqual(
        table === proposals ? ["plan_id", "base_version"] : ["plan_id", "version"],
      );
    }
    const owner = getTableConfig(plans).foreignKeys[0].reference();
    expect(getTableName(owner.foreignTable)).toBe("trip_guest_sessions");
    expect(owner.columns[0].name).toBe("owner_id");
  });

  it("keeps snapshot and restore checks in generated SQL, without silently dropping constraints", () => {
    expect(migration.match(/CREATE TABLE /g)).toHaveLength(5);
    expect(migration.match(/FOREIGN KEY /g)).toHaveLength(4);
    expect(migration).toContain('PRIMARY KEY("plan_id","version")');
    expect(migration).toContain('FOREIGN KEY ("plan_id","base_version")');
    expect(migration).toContain('"restored_from" < "trip_plan_versions"."version"');
    expect(migration).toContain("jsonb_typeof");
    expect(migration).not.toContain('"token"');
    expect(migration).not.toContain("DROP ");
    expect(migration).not.toContain("DATABASE_URL");
  });
});
