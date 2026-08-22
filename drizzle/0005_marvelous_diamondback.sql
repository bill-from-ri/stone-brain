CREATE TABLE "provider_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"base_url" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"api_key_last4" text NOT NULL,
	"model_id" text NOT NULL,
	"health" text DEFAULT 'unknown' NOT NULL,
	"health_detail" text,
	"health_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_settings" ADD CONSTRAINT "provider_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;