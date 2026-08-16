ALTER TABLE "claims" DROP CONSTRAINT "claims_signature_fk";
--> statement-breakpoint
ALTER TABLE "entities" DROP CONSTRAINT "entities_entity_type_fk";
--> statement-breakpoint
ALTER TABLE "entity_types" DROP CONSTRAINT "entity_types_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "predicate_signatures" DROP CONSTRAINT "predicate_signatures_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "predicate_signatures" DROP CONSTRAINT "predicate_signatures_predicate_fk";
--> statement-breakpoint
ALTER TABLE "predicate_signatures" DROP CONSTRAINT "predicate_signatures_subject_type_fk";
--> statement-breakpoint
ALTER TABLE "predicates" DROP CONSTRAINT "predicates_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "predicates" DROP CONSTRAINT "predicates_inverse_fk";
--> statement-breakpoint
ALTER TABLE "entity_types" DROP CONSTRAINT "entity_types_user_id_name_pk";--> statement-breakpoint
ALTER TABLE "predicate_signatures" DROP CONSTRAINT "predicate_signatures_user_id_predicate_subject_type_object_type_value_kind_pk";--> statement-breakpoint
ALTER TABLE "predicates" DROP CONSTRAINT "predicates_user_id_name_pk";--> statement-breakpoint
ALTER TABLE "entity_types" ADD PRIMARY KEY ("name");--> statement-breakpoint
ALTER TABLE "predicates" ADD PRIMARY KEY ("name");--> statement-breakpoint
ALTER TABLE "predicate_signatures" ADD CONSTRAINT "predicate_signatures_predicate_subject_type_object_type_value_kind_pk" PRIMARY KEY("predicate","subject_type","object_type","value_kind");--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_signature_fk" FOREIGN KEY ("predicate","subject_type","object_type_key","value_kind") REFERENCES "public"."predicate_signatures"("predicate","subject_type","object_type","value_kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_entity_type_entity_types_name_fk" FOREIGN KEY ("entity_type") REFERENCES "public"."entity_types"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predicate_signatures" ADD CONSTRAINT "predicate_signatures_predicate_fk" FOREIGN KEY ("predicate") REFERENCES "public"."predicates"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predicate_signatures" ADD CONSTRAINT "predicate_signatures_subject_type_fk" FOREIGN KEY ("subject_type") REFERENCES "public"."entity_types"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predicates" ADD CONSTRAINT "predicates_inverse_fk" FOREIGN KEY ("inverse_name") REFERENCES "public"."predicates"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_types" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "entity_types" DROP COLUMN "is_core";--> statement-breakpoint
ALTER TABLE "predicate_signatures" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "predicates" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "predicates" DROP COLUMN "is_core";