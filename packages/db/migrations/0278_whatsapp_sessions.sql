CREATE TABLE "whatsapp_sessions" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'off' NOT NULL,
	"phone" text,
	"answer_agent_id" uuid,
	"bridge_port" integer,
	"bridge_token_ciphertext" text,
	"wrapped_data_key" text,
	"kek_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_chats" (
	"org_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"thread_root_id" uuid NOT NULL,
	"participant_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_chats_org_id_chat_id_pk" PRIMARY KEY("org_id","chat_id")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_answer_agent_id_agents_id_fk" FOREIGN KEY ("answer_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "whatsapp_chats" ADD CONSTRAINT "whatsapp_chats_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
