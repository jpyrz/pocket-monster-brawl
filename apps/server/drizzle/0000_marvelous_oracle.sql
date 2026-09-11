CREATE TABLE "game_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"player_enabled" boolean DEFAULT false NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"game_profile_id" text NOT NULL,
	"frozen_at" timestamp with time zone,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "season_rule_versions" ADD CONSTRAINT "season_rule_versions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rule_versions" ADD CONSTRAINT "season_rule_versions_game_profile_id_game_profiles_id_fk" FOREIGN KEY ("game_profile_id") REFERENCES "public"."game_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_profile_id_version" ON "game_profiles" USING btree ("id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "season_rule_version" ON "season_rule_versions" USING btree ("season_id","version");