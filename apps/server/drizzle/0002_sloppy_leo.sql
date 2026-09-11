ALTER TABLE "save_imports" ADD COLUMN "tournament_id" uuid;--> statement-breakpoint
ALTER TABLE "save_imports" ADD COLUMN "data" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "team_drafts" ADD COLUMN "save_import_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "save_imports" ADD CONSTRAINT "save_imports_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_drafts" ADD CONSTRAINT "team_drafts_save_import_id_save_imports_id_fk" FOREIGN KEY ("save_import_id") REFERENCES "public"."save_imports"("id") ON DELETE no action ON UPDATE no action;