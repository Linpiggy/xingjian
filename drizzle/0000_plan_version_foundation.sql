CREATE TABLE "trip_guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_guest_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "trip_guest_token_digest" CHECK ("trip_guest_sessions"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "trip_guest_expiry" CHECK ("trip_guest_sessions"."expires_at" > "trip_guest_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "trip_plan_versions" (
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"restored_from" integer,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_plan_versions_plan_id_version_pk" PRIMARY KEY("plan_id","version"),
	CONSTRAINT "trip_version_nonnegative" CHECK ("trip_plan_versions"."version" >= 0),
	CONSTRAINT "trip_restore_older_version" CHECK ("trip_plan_versions"."restored_from" IS NULL OR ("trip_plan_versions"."restored_from" >= 0 AND "trip_plan_versions"."restored_from" < "trip_plan_versions"."version")),
	CONSTRAINT "trip_snapshot_object" CHECK (jsonb_typeof("trip_plan_versions"."snapshot") = 'object'),
	CONSTRAINT "trip_version_expiry" CHECK ("trip_plan_versions"."expires_at" > "trip_plan_versions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "trip_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"current_version" integer NOT NULL,
	"time_zone" varchar(32) DEFAULT 'Asia/Shanghai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_plan_version_nonnegative" CHECK ("trip_plans"."current_version" >= 0),
	CONSTRAINT "trip_plan_timezone" CHECK ("trip_plans"."time_zone" = 'Asia/Shanghai'),
	CONSTRAINT "trip_plan_expiry" CHECK ("trip_plans"."expires_at" > "trip_plans"."created_at")
);
--> statement-breakpoint
CREATE TABLE "trip_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"base_version" integer NOT NULL,
	"operation" jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_proposal_expiry" CHECK ("trip_proposals"."expires_at" > "trip_proposals"."created_at"),
	CONSTRAINT "trip_proposal_operation_object" CHECK (jsonb_typeof("trip_proposals"."operation") = 'object'),
	CONSTRAINT "trip_proposal_preview_object" CHECK (jsonb_typeof("trip_proposals"."preview") = 'object')
);
--> statement-breakpoint
CREATE TABLE "trip_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_shares_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "trip_share_token_digest" CHECK ("trip_shares"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "trip_share_snapshot_object" CHECK (jsonb_typeof("trip_shares"."snapshot") = 'object'),
	CONSTRAINT "trip_share_expiry" CHECK ("trip_shares"."expires_at" > "trip_shares"."created_at")
);
--> statement-breakpoint
ALTER TABLE "trip_plan_versions" ADD CONSTRAINT "trip_plan_versions_plan_id_trip_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."trip_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_plans" ADD CONSTRAINT "trip_plans_owner_id_trip_guest_sessions_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."trip_guest_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_proposals" ADD CONSTRAINT "trip_proposal_base_version_fk" FOREIGN KEY ("plan_id","base_version") REFERENCES "public"."trip_plan_versions"("plan_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_shares" ADD CONSTRAINT "trip_share_version_fk" FOREIGN KEY ("plan_id","version") REFERENCES "public"."trip_plan_versions"("plan_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_plans_owner_idx" ON "trip_plans" USING btree ("owner_id");