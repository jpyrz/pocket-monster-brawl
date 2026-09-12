CREATE TABLE "battle_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"battle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"player_slot" text NOT NULL,
	"request_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"choice_type" text NOT NULL,
	"choice_slot" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "seed" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "engine_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "format_id" text DEFAULT 'gen3customgame' NOT NULL;--> statement-breakpoint
ALTER TABLE "battle_decisions" ADD CONSTRAINT "battle_decisions_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_decisions" ADD CONSTRAINT "battle_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "battle_decision_idempotency" ON "battle_decisions" USING btree ("battle_id","user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "battle_decision_request" ON "battle_decisions" USING btree ("battle_id","player_slot","request_id");