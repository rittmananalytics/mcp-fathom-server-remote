#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { 
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListToolsRequest,
  CallToolRequest,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequest,
  ListPromptsRequest
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { FathomClient } from "./fathom-client.js";
import dotenv from "dotenv";

dotenv.config();

const ListMeetingsSchema = z.object({
  calendar_invitees: z.array(z.string()).optional().describe("Filter by attendee email addresses"),
  calendar_invitees_domains: z.array(z.string()).optional().describe("Filter by company domains"),
  created_after: z.string().optional().describe("Filter meetings created after this date (ISO 8601)"),
  created_before: z.string().optional().describe("Filter meetings created before this date (ISO 8601)"),
  include_transcript: z.boolean().optional().default(false).describe("Include meeting transcripts"),
  meeting_type: z.enum(['all', 'internal', 'external']).optional().default('all').describe("Filter by meeting type"),
  recorded_by: z.array(z.string()).optional().describe("Filter by meeting owner email addresses"),
  teams: z.array(z.string()).optional().describe("Filter by team names"),
  limit: z.number().optional().default(50).describe("Maximum number of meetings to return")
});

const SearchMeetingsSchema = z.object({
  search_term: z.string().describe("Search term to find in meeting titles, summaries, action items, or transcripts"),
  include_transcript: z.boolean().optional().default(true).describe("Search within full meeting transcripts (default: true). When enabled, fetches and searches transcripts of up to 10 recent meetings. Use this for semantic queries like 'discussed pricing' or 'talked about Claude Code'.")
});

const GetMeetingTranscriptSchema = z.object({
  recording_id: z.string().describe("The recording ID of the meeting"),
  summarize: z.boolean().optional().default(false).describe("Whether to return a request for Claude to summarize the transcript")
});

const ListTeamsSchema = z.object({});

const ListTeamMembersSchema = z.object({
  team_id: z.string().describe("The ID of the team to list members for")
});

const CreateWebhookSchema = z.object({
  url: z.string().describe("The URL to send webhook notifications to"),
  include_transcript: z.boolean().optional().default(false).describe("Include meeting transcripts in webhook payload"),
  include_summary: z.boolean().optional().default(true).describe("Include meeting summaries in webhook payload"),
  include_action_items: z.boolean().optional().default(true).describe("Include action items in webhook payload")
});

const DeleteWebhookSchema = z.object({
  webhook_id: z.string().describe("The ID of the webhook to delete")
});

const apiKey = process.env.FATHOM_API_KEY;
if (!apiKey) {
  console.error("Error: FATHOM_API_KEY environment variable is required");
  console.error("Please set it in your environment variables or Claude Desktop config");
  console.error("See README.md for setup instructions");
  process.exit(1);
}

const fathomClient = new FathomClient(apiKey);

const server = new Server({
  name: "mcp-fathom-server",
  version: "2.0.0"
}, {
  capabilities: {
    tools: {},
    resources: {},
    prompts: {}
  }
});

server.setRequestHandler(ListToolsRequestSchema, async (request: ListToolsRequest) => ({
  tools: [
    {
      name: "list_meetings",
      description: "List Fathom meetings with optional filters. Returns meeting titles, summaries, dates, and participants.",
      inputSchema: zodToJsonSchema(ListMeetingsSchema)
    },
    {
      name: "search_meetings",
      description: "Search for meetings containing keywords in titles, summaries, action items, AND full transcripts (default). Searches last 30 days. By default, fetches and searches transcripts of up to 10 recent meetings. Best for semantic queries like 'discussed pricing' or 'talked about Claude Code' where the topic may not appear in titles/summaries.",
      inputSchema: zodToJsonSchema(SearchMeetingsSchema)
    },
    {
      name: "get_meeting_transcript",
      description: "Get the full transcript of a specific meeting by recording ID. Useful for detailed analysis or summarization of meeting content.",
      inputSchema: zodToJsonSchema(GetMeetingTranscriptSchema)
    },
    {
      name: "list_teams",
      description: "List all teams accessible to the authenticated user.",
      inputSchema: zodToJsonSchema(ListTeamsSchema)
    },
    {
      name: "list_team_members",
      description: "List all members of a specific team.",
      inputSchema: zodToJsonSchema(ListTeamMembersSchema)
    },
    {
      name: "create_webhook",
      description: "Create a webhook to receive real-time notifications when new meetings are ready. Returns webhook ID and secret for verification.",
      inputSchema: zodToJsonSchema(CreateWebhookSchema)
    },
    {
      name: "delete_webhook",
      description: "Delete an existing webhook by its ID.",
      inputSchema: zodToJsonSchema(DeleteWebhookSchema)
    }
  ]
}));

// Add stub handlers for resources and prompts to prevent "Method not found" errors
server.setRequestHandler(ListResourcesRequestSchema, async (request: ListResourcesRequest) => ({
  resources: []
}));

server.setRequestHandler(ListPromptsRequestSchema, async (request: ListPromptsRequest) => ({
  prompts: []
}));

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params;
  
  try {
    if (name === "list_meetings") {
      const params = ListMeetingsSchema.parse(args);
      const limit = params.limit || 50;
      const { limit: _, ...apiParams } = params;
      
      console.error(`[list_meetings] Fetching meetings with params:`, JSON.stringify(apiParams));
      const response = await fathomClient.listMeetings(apiParams);
      console.error(`[list_meetings] Got ${response.items.length} meetings`);
      const meetings = response.items.slice(0, limit);
      
      const formattedMeetings = meetings.map(meeting => ({
        title: meeting.title || meeting.meeting_title,
        date: meeting.scheduled_start_time || meeting.created_at,
        url: meeting.share_url || meeting.url,
        recording_id: meeting.recording_id,
        attendees: meeting.calendar_invitees,
        recorded_by: meeting.recorded_by,
        summary: meeting.default_summary,
        action_items: meeting.action_items,
        transcript: params.include_transcript ? meeting.transcript : undefined
      }));
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_found: response.items.length,
            showing: meetings.length,
            meetings: formattedMeetings,
            has_more: !!response.next_cursor
          }, null, 2)
        }]
      };
    }
    
    if (name === "search_meetings") {
      const params = SearchMeetingsSchema.parse(args);

      console.error(`[search_meetings] Searching for: "${params.search_term}" (transcript=${params.include_transcript})`);
      const meetings = await fathomClient.searchMeetings(
        params.search_term,
        params.include_transcript
      );
      console.error(`[search_meetings] Found ${meetings.length} matching meetings`);

      const formattedMeetings = meetings.map(meeting => ({
        title: meeting.title || meeting.meeting_title,
        date: meeting.scheduled_start_time || meeting.created_at,
        url: meeting.share_url || meeting.url,
        recording_id: meeting.recording_id,
        attendees: meeting.calendar_invitees,
        recorded_by: meeting.recorded_by,
        summary: meeting.default_summary,
        action_items: meeting.action_items,
        transcript: params.include_transcript ? meeting.transcript : undefined,
        relevance: params.include_transcript && meeting.transcript?.toLowerCase().includes(params.search_term.toLowerCase())
          ? "Found in transcript"
          : "Found in title/summary"
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            search_term: params.search_term,
            total_found: meetings.length,
            meetings: formattedMeetings
          }, null, 2)
        }]
      };
    }

    if (name === "get_meeting_transcript") {
      const params = GetMeetingTranscriptSchema.parse(args);

      console.error(`[get_meeting_transcript] Fetching transcript for recording: ${params.recording_id}`);
      const transcript = await fathomClient.getMeetingTranscript(params.recording_id);
      console.error(`[get_meeting_transcript] Got transcript (${transcript.length} characters)`);

      // Handle empty transcript
      if (!transcript || transcript.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No transcript available for recording ${params.recording_id}. The meeting may still be processing, or transcription may not be available.`
          }]
        };
      }

      return {
        content: [{
          type: "text",
          text: params.summarize
            ? `Please summarize this meeting transcript:\n\n${transcript}`
            : transcript
        }]
      };
    }

    if (name === "list_teams") {
      console.error(`[list_teams] Fetching teams`);
      const response = await fathomClient.listTeams();
      console.error(`[list_teams] Got ${response.items.length} teams`);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_teams: response.items.length,
            teams: response.items,
            has_more: !!response.next_cursor
          }, null, 2)
        }]
      };
    }

    if (name === "list_team_members") {
      const params = ListTeamMembersSchema.parse(args);

      console.error(`[list_team_members] Fetching members for team: ${params.team_id}`);
      const response = await fathomClient.listTeamMembers({ team_id: params.team_id });
      console.error(`[list_team_members] Got ${response.items.length} members`);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            team_id: params.team_id,
            total_members: response.items.length,
            members: response.items,
            has_more: !!response.next_cursor
          }, null, 2)
        }]
      };
    }

    if (name === "create_webhook") {
      const params = CreateWebhookSchema.parse(args);

      console.error(`[create_webhook] Creating webhook for URL: ${params.url}`);
      const response = await fathomClient.createWebhook(params);
      console.error(`[create_webhook] Created webhook: ${response.webhook.id}`);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            webhook: response.webhook,
            secret: response.secret,
            note: "Save this secret securely - it's needed to verify webhook signatures and won't be shown again."
          }, null, 2)
        }]
      };
    }

    if (name === "delete_webhook") {
      const params = DeleteWebhookSchema.parse(args);

      console.error(`[delete_webhook] Deleting webhook: ${params.webhook_id}`);
      await fathomClient.deleteWebhook(params);
      console.error(`[delete_webhook] Deleted webhook: ${params.webhook_id}`);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            webhook_id: params.webhook_id,
            message: "Webhook deleted successfully"
          }, null, 2)
        }]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error in ${name}:`, errorMessage);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ error: errorMessage }, null, 2)
      }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Fathom MCP Server started successfully");
  console.error(`Connected to Fathom API`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});