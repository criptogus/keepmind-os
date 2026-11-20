CREATE TABLE "message_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"note" text,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reminders_userId_messageId_unique" UNIQUE("user_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "message_reminders" ADD CONSTRAINT "message_reminders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reminders" ADD CONSTRAINT "message_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reminders" ADD CONSTRAINT "message_reminders_org_id_channel_id_channels_org_id_id_fk" FOREIGN KEY ("org_id","channel_id") REFERENCES "public"."channels"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_reminders_user_id_done_at_remind_at_index" ON "message_reminders" USING btree ("user_id","done_at","remind_at");--> statement-breakpoint
CREATE INDEX "message_reminders_org_id_remind_at_index" ON "message_reminders" USING btree ("org_id","remind_at");