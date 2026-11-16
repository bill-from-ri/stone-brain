CREATE TABLE "claim_retractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"document_id" uuid,
	"claim_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"claim" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_retractions_outcome" CHECK ("claim_retractions"."outcome" in ('deleted', 'citation_removed', 'held'))
);
--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD COLUMN "claims_retracted" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD COLUMN "claims_kept" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_retractions" ADD CONSTRAINT "claim_retractions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_retractions" ADD CONSTRAINT "claim_retractions_run_id_extraction_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_retractions" ADD CONSTRAINT "claim_retractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_retractions_run_idx" ON "claim_retractions" USING btree ("run_id");