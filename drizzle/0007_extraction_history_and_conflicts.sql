CREATE TABLE "conflict_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conflict_dismissals_kind" CHECK ("conflict_dismissals"."kind" in ('value', 'vanished_source'))
);
--> statement-breakpoint
CREATE TABLE "extraction_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"received" jsonb,
	"position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_issues_stage" CHECK ("extraction_issues"."stage" in ('validation', 'write'))
);
--> statement-breakpoint
CREATE TABLE "extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"status" text NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"model_requested" text,
	"model" text,
	"attempts" integer,
	"response_format" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"drive_version" bigint,
	"revision_id" text,
	"claims_extracted" integer DEFAULT 0 NOT NULL,
	"claims_created" integer DEFAULT 0 NOT NULL,
	"claims_already_present" integer DEFAULT 0 NOT NULL,
	"inverses_created" integer DEFAULT 0 NOT NULL,
	"sources_created" integer DEFAULT 0 NOT NULL,
	"entities_created" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "extraction_runs_status" CHECK ("extraction_runs"."status" in ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "predicate_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid,
	"document_id" uuid,
	"document_name" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"subject_type" text,
	"object_type" text,
	"example_subject" text,
	"example_object" text,
	"quote" text,
	"paragraph_index" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "predicate_proposals_status" CHECK ("predicate_proposals"."status" in ('open', 'promoted', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "conflict_dismissals" ADD CONSTRAINT "conflict_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_issues" ADD CONSTRAINT "extraction_issues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_issues" ADD CONSTRAINT "extraction_issues_run_id_extraction_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predicate_proposals" ADD CONSTRAINT "predicate_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predicate_proposals" ADD CONSTRAINT "predicate_proposals_run_id_extraction_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predicate_proposals" ADD CONSTRAINT "predicate_proposals_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conflict_dismissals_user_kind_key_uq" ON "conflict_dismissals" USING btree ("user_id","kind","key");--> statement-breakpoint
CREATE INDEX "extraction_issues_run_idx" ON "extraction_issues" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "extraction_runs_user_document_idx" ON "extraction_runs" USING btree ("user_id","document_id","started_at");--> statement-breakpoint
CREATE INDEX "predicate_proposals_user_status_idx" ON "predicate_proposals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "predicate_proposals_user_name_idx" ON "predicate_proposals" USING btree ("user_id","name");