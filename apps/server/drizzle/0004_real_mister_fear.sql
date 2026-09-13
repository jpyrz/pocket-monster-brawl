CREATE TABLE "trainer_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"trainer_sprite" text DEFAULT 'red' NOT NULL,
	"partner_pokemon_snapshot_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trainer_profiles" ADD CONSTRAINT "trainer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_profiles" ADD CONSTRAINT "trainer_profiles_partner_pokemon_snapshot_id_pokemon_snapshots_id_fk" FOREIGN KEY ("partner_pokemon_snapshot_id") REFERENCES "public"."pokemon_snapshots"("id") ON DELETE no action ON UPDATE no action;