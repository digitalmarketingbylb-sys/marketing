CREATE TYPE "public"."account_status" AS ENUM('active', 'pending_access', 'manual_only', 'not_established');--> statement-breakpoint
CREATE TYPE "public"."aggregation" AS ENUM('sum', 'avg', 'last', 'max');--> statement-breakpoint
CREATE TYPE "public"."auth_type" AS ENUM('oauth2', 'service_account', 'api_key', 'manual');--> statement-breakpoint
CREATE TYPE "public"."brand_kind" AS ENUM('company', 'person');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('website', 'linkedin', 'youtube', 'x', 'instagram', 'facebook', 'substack', 'reddit', 'quora');--> statement-breakpoint
CREATE TYPE "public"."content_format" AS ENUM('post', 'article', 'video', 'short', 'newsletter', 'page', 'thread');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('idea', 'draft', 'review', 'scheduled', 'published');--> statement-breakpoint
CREATE TYPE "public"."metric_category" AS ENUM('reach', 'engagement', 'acquisition', 'audience', 'conversion');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('ga4', 'google_search_console', 'linkedin_marketing', 'youtube_data', 'x_api', 'meta_graph', 'substack', 'reddit_api', 'quora', 'manual_csv');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "brand_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"provider" "provider" NOT NULL,
	"display_name" text NOT NULL,
	"handle" text,
	"url" text,
	"external_id" text,
	"status" "account_status" DEFAULT 'pending_access' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"auth_type" "auth_type" NOT NULL,
	"encrypted_credentials" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"external_id" text,
	"url" text,
	"title" text,
	"format" "content_format" DEFAULT 'post' NOT NULL,
	"status" "content_status" DEFAULT 'idea' NOT NULL,
	"topic_pillar" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_metric_facts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"date" date NOT NULL,
	"value" numeric(20, 4) NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dimensions_hash" text NOT NULL,
	"provider" "provider" NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_definitions" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"unit" text DEFAULT 'count' NOT NULL,
	"aggregation" "aggregation" NOT NULL,
	"category" "metric_category" NOT NULL,
	"higher_is_better" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_facts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"date" date NOT NULL,
	"value" numeric(20, 4) NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dimensions_hash" text NOT NULL,
	"provider" "provider" NOT NULL,
	"sync_run_id" uuid,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"channel" "channel",
	"metric_key" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"target_value" numeric(20, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"channel_account_id" uuid,
	"provider" "provider" NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"range_start" date,
	"range_end" date,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_metric_facts" ADD CONSTRAINT "content_metric_facts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_metric_facts" ADD CONSTRAINT "content_metric_facts_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_metric_facts" ADD CONSTRAINT "content_metric_facts_metric_key_metric_definitions_key_fk" FOREIGN KEY ("metric_key") REFERENCES "public"."metric_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_facts" ADD CONSTRAINT "metric_facts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_facts" ADD CONSTRAINT "metric_facts_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_facts" ADD CONSTRAINT "metric_facts_metric_key_metric_definitions_key_fk" FOREIGN KEY ("metric_key") REFERENCES "public"."metric_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_targets" ADD CONSTRAINT "metric_targets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_targets" ADD CONSTRAINT "metric_targets_metric_key_metric_definitions_key_fk" FOREIGN KEY ("metric_key") REFERENCES "public"."metric_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_client_slug_key" ON "brands" USING btree ("client_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_accounts_client_provider_external_key" ON "channel_accounts" USING btree ("client_id","provider","external_id") WHERE "channel_accounts"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "channel_accounts_client_idx" ON "channel_accounts" USING btree ("client_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_slug_key" ON "clients" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_client_provider_key" ON "connections" USING btree ("client_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "content_items_account_external_key" ON "content_items" USING btree ("channel_account_id","external_id") WHERE "content_items"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "content_items_client_published_idx" ON "content_items" USING btree ("client_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_metric_facts_grain_key" ON "content_metric_facts" USING btree ("content_item_id","metric_key","date","dimensions_hash");--> statement-breakpoint
CREATE INDEX "content_metric_facts_client_date_idx" ON "content_metric_facts" USING btree ("client_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_facts_grain_key" ON "metric_facts" USING btree ("channel_account_id","metric_key","date","dimensions_hash");--> statement-breakpoint
CREATE INDEX "metric_facts_client_date_idx" ON "metric_facts" USING btree ("client_id","date");--> statement-breakpoint
CREATE INDEX "metric_facts_account_metric_date_idx" ON "metric_facts" USING btree ("channel_account_id","metric_key","date");--> statement-breakpoint
CREATE INDEX "metric_targets_client_metric_idx" ON "metric_targets" USING btree ("client_id","metric_key");--> statement-breakpoint
CREATE INDEX "sync_runs_client_started_idx" ON "sync_runs" USING btree ("client_id","started_at");