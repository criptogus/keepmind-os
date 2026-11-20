CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"thread_id" uuid,
	"body" text NOT NULL,
	"reply_to" uuid,
	"attachments" text[] DEFAULT '{}'::text[] NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"client_id" text,
	"sent_at" timestamp with time zone,
	"sent_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_messages_orgId_userId_clientId_unique" UNIQUE("org_id","user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_org_id_channel_id_channels_org_id_id_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "public"."channels"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_messages_user_id_send_at_index" ON "scheduled_messages" USING btree ("user_id","send_at");--> statement-breakpoint
CREATE INDEX "scheduled_messages_org_id_send_at_index" ON "scheduled_messages" USING btree ("org_id","send_at");
