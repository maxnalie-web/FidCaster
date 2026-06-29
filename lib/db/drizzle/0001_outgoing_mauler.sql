CREATE TABLE "ai_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"provider" text NOT NULL,
	"api_key" text DEFAULT '' NOT NULL,
	"base_url" text,
	"default_model" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"command" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_environments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"variables" text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"collection_id" integer NOT NULL,
	"name" text NOT NULL,
	"method" text DEFAULT 'GET' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"headers" text DEFAULT '[]' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"body_type" text DEFAULT 'none' NOT NULL,
	"auth" text DEFAULT '{}' NOT NULL,
	"tests" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snippets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger" text DEFAULT '' NOT NULL,
	"language" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_scripts" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"command" text NOT NULL,
	"icon" text DEFAULT 'Zap' NOT NULL,
	"color" text DEFAULT 'purple' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"type" text DEFAULT 'static' NOT NULL,
	"region" text DEFAULT 'us-east' NOT NULL,
	"url" text,
	"custom_domain" text,
	"custom_domain_status" text DEFAULT 'unverified',
	"logs" text,
	"build_duration" integer,
	"error_message" text,
	"env_vars" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "validation_configs" ADD CONSTRAINT "validation_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_collections" ADD CONSTRAINT "api_collections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_environments" ADD CONSTRAINT "api_environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_requests" ADD CONSTRAINT "api_requests_collection_id_api_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."api_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_scripts" ADD CONSTRAINT "project_scripts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_sessions" ADD CONSTRAINT "time_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;