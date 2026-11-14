CREATE TABLE "legacy_agent_policies" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"owner_user_id" text NOT NULL,
	"monthly_run_cap" integer,
	"history_captured" boolean DEFAULT false NOT NULL,
	"prior_runs_by_month" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timeout_seconds" integer NOT NULL,
	"source_digest" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_run_admissions" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"admitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"actor_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"states" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"poll" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_workflow_runs_workflowId_requestId_unique" UNIQUE("workflow_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "legacy_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_ref" text NOT NULL,
	"source_team_id" text NOT NULL,
	"source_digest" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text NOT NULL,
	"steps" jsonb NOT NULL,
	CONSTRAINT "legacy_workflows_orgId_sourceRef_sourceTeamId_unique" UNIQUE("org_id","source_ref","source_team_id")
);
--> statement-breakpoint
ALTER TABLE "legacy_agent_policies" ADD CONSTRAINT "legacy_agent_policies_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_agent_policies" ADD CONSTRAINT "legacy_agent_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_run_admissions" ADD CONSTRAINT "legacy_run_admissions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_workflow_runs" ADD CONSTRAINT "legacy_workflow_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_workflow_runs" ADD CONSTRAINT "legacy_workflow_runs_workflow_id_legacy_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."legacy_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_workflows" ADD CONSTRAINT "legacy_workflows_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;