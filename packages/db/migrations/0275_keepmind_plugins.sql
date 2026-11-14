CREATE TABLE "workspace_plugins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"digest" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"agent_ids" uuid[] DEFAULT '{}' NOT NULL,
	"records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_plugins_org_slug" UNIQUE("org_id","slug")
);
--> statement-breakpoint
ALTER TABLE "workspace_plugins" ADD CONSTRAINT "workspace_plugins_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;