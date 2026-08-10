CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"drive_file_id" text NOT NULL,
	"parent_drive_folder_id" text,
	"folder_id" uuid,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"drive_version" bigint,
	"head_revision_id" text,
	"extracted_revision_id" text,
	"modified_time" timestamp with time zone,
	"created_time" timestamp with time zone,
	"web_view_link" text,
	"icon_link" text,
	"owner_display_name" text,
	"owned_by_me" boolean,
	"status" text DEFAULT 'unread' NOT NULL,
	"trashed" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"sweep_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"drive_folder_id" text NOT NULL,
	"parent_drive_folder_id" text,
	"folder_id" uuid,
	"name" text NOT NULL,
	"path" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"is_root" boolean DEFAULT false NOT NULL,
	"trashed" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"drive_modified_time" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"sweep_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token_enc" text,
	"access_token_enc" text,
	"access_token_expires_at" timestamp with time zone,
	"granted_scopes" text DEFAULT '' NOT NULL,
	"token_status" text DEFAULT 'active' NOT NULL,
	"token_invalid_at" timestamp with time zone,
	"last_refresh_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"root_drive_folder_id" text,
	"root_folder_name" text,
	"start_page_token" text,
	"pending_start_page_token" text,
	"initial_crawl_done" boolean DEFAULT false NOT NULL,
	"crawl_cursor" jsonb,
	"pending_subtree_crawls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sweep_id" uuid,
	"last_sync_started_at" timestamp with time zone,
	"last_sync_completed_at" timestamp with time zone,
	"last_sync_error" text,
	"sync_seq" bigint DEFAULT 0 NOT NULL,
	"lock_token" uuid,
	"lock_acquired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"picture_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_user_drive_id_uq" ON "documents" USING btree ("user_id","drive_file_id");--> statement-breakpoint
CREATE INDEX "documents_user_parent_removed_idx" ON "documents" USING btree ("user_id","parent_drive_folder_id","removed_at");--> statement-breakpoint
CREATE INDEX "documents_user_status_idx" ON "documents" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "folders_user_drive_id_uq" ON "folders" USING btree ("user_id","drive_folder_id");--> statement-breakpoint
CREATE INDEX "folders_user_parent_idx" ON "folders" USING btree ("user_id","parent_drive_folder_id");--> statement-breakpoint
CREATE INDEX "folders_user_removed_idx" ON "folders" USING btree ("user_id","removed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "google_accounts_user_provider_uq" ON "google_accounts" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "google_accounts_provider_account_uq" ON "google_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_uq" ON "users" USING btree ("google_sub");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");