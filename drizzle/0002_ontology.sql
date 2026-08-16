CREATE TABLE "claim_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"document_id" uuid,
	"document_name" text,
	"quote" text,
	"paragraph_index" integer,
	"document_revision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"subject_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"predicate" text NOT NULL,
	"object_id" uuid,
	"object_type" text,
	"value_int" bigint,
	"value_float" double precision,
	"value_string" text,
	"value_time" text,
	"value_order" double precision,
	"start_time" text,
	"start_order" double precision,
	"end_time" text,
	"end_order" double precision,
	"canonicity" text DEFAULT 'draft' NOT NULL,
	"confidence" double precision,
	"created_by" text DEFAULT 'user' NOT NULL,
	"extracted_by_model" text,
	"object_type_key" text GENERATED ALWAYS AS (coalesce(object_type, '@none')) STORED NOT NULL,
	"value_kind" text GENERATED ALWAYS AS (case
          when value_int is not null then 'int'
          when value_float is not null then 'float'
          when value_string is not null then 'string'
          when value_time is not null then 'date'
          else '@none'
        end) STORED NOT NULL,
	"fingerprint" text GENERATED ALWAYS AS (subject_id::text
          || '|' || predicate
          || '|' || coalesce(object_id::text, '')
          || '|' || coalesce(value_int::text, '')
          || '|' || coalesce(value_float::text, '')
          || '|' || coalesce(value_string, '')
          || '|' || coalesce(value_time, '')
          || '|' || coalesce(start_time, '')
          || '|' || coalesce(end_time, '')) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_canonicity" CHECK ("claims"."canonicity" in ('canon', 'draft')),
	CONSTRAINT "claims_object_pair" CHECK (("claims"."object_id" is null) = ("claims"."object_type" is null)),
	CONSTRAINT "claims_value_arity" CHECK (case when "claims"."object_id" is not null then 0 else 1 end =
        (case when "claims"."value_int" is not null then 1 else 0 end)
        + (case when "claims"."value_float" is not null then 1 else 0 end)
        + (case when "claims"."value_string" is not null then 1 else 0 end)
        + (case when "claims"."value_time" is not null then 1 else 0 end)),
	CONSTRAINT "claims_no_self_relation" CHECK ("claims"."object_id" is null or "claims"."object_id" <> "claims"."subject_id"),
	CONSTRAINT "claims_time_order" CHECK ("claims"."start_order" is null or "claims"."end_order" is null or "claims"."end_order" >= "claims"."start_order"),
	CONSTRAINT "claims_value_order" CHECK ("claims"."value_order" is null or "claims"."value_time" is not null)
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"entity_type" text NOT NULL,
	"name" text NOT NULL,
	"name_variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"normalized_name" text NOT NULL,
	"canonicity" text DEFAULT 'draft' NOT NULL,
	"summary" text,
	"source_document_id" uuid,
	"created_by" text DEFAULT 'user' NOT NULL,
	"extracted_by_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_user_id_type_uq" UNIQUE("user_id","id","entity_type"),
	CONSTRAINT "entities_canonicity" CHECK ("entities"."canonicity" in ('canon', 'draft'))
);
--> statement-breakpoint
CREATE TABLE "entity_types" (
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"plural_label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_types_user_id_name_pk" PRIMARY KEY("user_id","name"),
	CONSTRAINT "entity_types_name_format" CHECK ("entity_types"."name" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "predicate_signatures" (
	"user_id" uuid NOT NULL,
	"predicate" text NOT NULL,
	"subject_type" text NOT NULL,
	"object_type" text DEFAULT '@none' NOT NULL,
	"value_kind" text DEFAULT '@none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "predicate_signatures_user_id_predicate_subject_type_object_type_value_kind_pk" PRIMARY KEY("user_id","predicate","subject_type","object_type","value_kind"),
	CONSTRAINT "predicate_signatures_object_type" CHECK ("predicate_signatures"."object_type" = '@none' or "predicate_signatures"."object_type" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "predicate_signatures_value_kind" CHECK ("predicate_signatures"."value_kind" in ('@none', 'int', 'float', 'string', 'date')),
	CONSTRAINT "predicate_signatures_exactly_one_kind" CHECK (("predicate_signatures"."object_type" = '@none') <> ("predicate_signatures"."value_kind" = '@none'))
);
--> statement-breakpoint
CREATE TABLE "predicates" (
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"inverse_name" text,
	"is_symmetric" boolean DEFAULT false NOT NULL,
	"is_temporal" boolean DEFAULT false NOT NULL,
	"is_functional" boolean DEFAULT false NOT NULL,
	"value_type" text,
	"value_enum" jsonb,
	"unit" text,
	"is_core" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "predicates_user_id_name_pk" PRIMARY KEY("user_id","name"),
	CONSTRAINT "predicates_name_format" CHECK ("predicates"."name" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "predicates_kind" CHECK ("predicates"."kind" in ('relationship', 'attribute')),
	CONSTRAINT "predicates_value_type" CHECK ("predicates"."value_type" is null or "predicates"."value_type" in ('int', 'float', 'string', 'date')),
	CONSTRAINT "predicates_kind_value_type" CHECK (("predicates"."kind" = 'attribute') = ("predicates"."value_type" is not null)),
	CONSTRAINT "predicates_enum_is_string_attribute" CHECK ("predicates"."value_enum" is null or "predicates"."value_type" = 'string'),
	CONSTRAINT "predicates_symmetric_inverse" CHECK (not "predicates"."is_symmetric" or "predicates"."inverse_name" = "predicates"."name")
);
--> statement-breakpoint
ALTER TABLE "claim_sources" ADD CONSTRAINT "claim_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_sources" ADD CONSTRAINT "claim_sources_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_sources" ADD CONSTRAINT "claim_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_subject_fk" FOREIGN KEY ("user_id","subject_id","subject_type") REFERENCES "public"."entities"("user_id","id","entity_type") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_object_fk" FOREIGN KEY ("user_id","object_id","object_type") REFERENCES "public"."entities"("user_id","id","entity_type") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_signature_fk" FOREIGN KEY ("user_id","predicate","subject_type","object_type_key","value_kind") REFERENCES "public"."predicate_signatures"("user_id","predicate","subject_type","object_type","value_kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_entity_type_fk" FOREIGN KEY ("user_id","entity_type") REFERENCES "public"."entity_types"("user_id","name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_types" ADD CONSTRAINT "entity_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predicate_signatures" ADD CONSTRAINT "predicate_signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predicate_signatures" ADD CONSTRAINT "predicate_signatures_predicate_fk" FOREIGN KEY ("user_id","predicate") REFERENCES "public"."predicates"("user_id","name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predicate_signatures" ADD CONSTRAINT "predicate_signatures_subject_type_fk" FOREIGN KEY ("user_id","subject_type") REFERENCES "public"."entity_types"("user_id","name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predicates" ADD CONSTRAINT "predicates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predicates" ADD CONSTRAINT "predicates_inverse_fk" FOREIGN KEY ("user_id","inverse_name") REFERENCES "public"."predicates"("user_id","name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_sources_claim_doc_para_uq" ON "claim_sources" USING btree ("claim_id","document_id","paragraph_index");--> statement-breakpoint
CREATE INDEX "claim_sources_user_document_idx" ON "claim_sources" USING btree ("user_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_user_fingerprint_uq" ON "claims" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "claims_user_subject_idx" ON "claims" USING btree ("user_id","subject_id","predicate");--> statement-breakpoint
CREATE INDEX "claims_user_object_idx" ON "claims" USING btree ("user_id","object_id","predicate");--> statement-breakpoint
CREATE INDEX "claims_user_predicate_idx" ON "claims" USING btree ("user_id","predicate");--> statement-breakpoint
CREATE INDEX "claims_user_canonicity_idx" ON "claims" USING btree ("user_id","canonicity");--> statement-breakpoint
CREATE INDEX "entities_user_type_norm_idx" ON "entities" USING btree ("user_id","entity_type","normalized_name");--> statement-breakpoint
CREATE INDEX "entities_user_type_idx" ON "entities" USING btree ("user_id","entity_type");--> statement-breakpoint
CREATE INDEX "entities_user_canonicity_idx" ON "entities" USING btree ("user_id","canonicity");