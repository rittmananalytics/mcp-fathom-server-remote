#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequest,
  CallToolRequest,
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
  console.error("Please set it in your environment variables or Cloud Run configuration");
  process.exit(1);
}

const fathomClient = new FathomClient(apiKey);

// Function to create and configure a new MCP server instance
function createMcpServer(): Server {
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

  // Add stub handlers for resources and prompts
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

  return server;
}

// Create Express application
const app = express();
app.use(express.json());

// Configure CORS to expose Mcp-Session-Id header for browser-based clients
app.use(cors({
  origin: '*', // Allow all origins - adjust as needed for production
  exposedHeaders: ['Mcp-Session-Id']
}));

// Store transports by session ID
const transports: Record<string, SSEServerTransport | StreamableHTTPServerTransport> = {};

// Health check endpoint for Cloud Run
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'mcp-fathom-server' });
});

//=============================================================================
// STREAMABLE HTTP TRANSPORT (PROTOCOL VERSION 2025-03-26)
//=============================================================================
app.all('/mcp', async (req, res) => {
  console.log(`Received ${req.method} request to /mcp`);

  try {
    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      const existingTransport = transports[sessionId];

      if (existingTransport instanceof StreamableHTTPServerTransport) {
        // Reuse existing transport
        transport = existingTransport;
      } else {
        // Transport exists but is not a StreamableHTTPServerTransport
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Session exists but uses a different transport protocol',
          },
          id: null,
        });
        return;
      }
    } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
      // New session - create transport
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          console.log(`StreamableHTTP session initialized with ID: ${sessionId}`);
          transports[sessionId] = transport;
        }
      });

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Transport closed for session ${sid}, removing from transports map`);
          delete transports[sid];
        }
      };

      // Connect the transport to the MCP server
      const server = createMcpServer();
      await server.connect(transport);
    } else {
      // Invalid request - no session ID or not initialization request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided or not an initialize request',
        },
        id: null,
      });
      return;
    }

    // Handle the request with the transport
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

//=============================================================================
// DEPRECATED HTTP+SSE TRANSPORT (PROTOCOL VERSION 2024-11-05)
//=============================================================================
app.get('/sse', async (req, res) => {
  console.log('Received GET request to /sse (deprecated SSE transport)');

  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  const server = createMcpServer();
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const existingTransport = transports[sessionId];

  if (existingTransport instanceof SSEServerTransport) {
    await existingTransport.handlePostMessage(req, res, req.body);
  } else if (existingTransport) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: Session exists but uses a different transport protocol',
      },
      id: null,
    });
  } else {
    res.status(400).send('No transport found for sessionId');
  }
});

// Start the server
const PORT = process.env.PORT || 8080;

async function main() {
  app.listen(PORT, () => {
    console.error(`Fathom MCP Server (HTTP) started on port ${PORT}`);
    console.error(`Connected to Fathom API`);
    console.error(`
==============================================
SUPPORTED TRANSPORT OPTIONS:

1. Streamable HTTP (Protocol version: 2025-03-26)
   Endpoint: /mcp
   Methods: GET, POST, DELETE
   Usage:
     - Initialize with POST to /mcp
     - Establish SSE stream with GET to /mcp
     - Send requests with POST to /mcp
     - Terminate session with DELETE to /mcp

2. HTTP + SSE (Protocol version: 2024-11-05)
   Endpoints: /sse (GET) and /messages (POST)
   Usage:
     - Establish SSE stream with GET to /sse
     - Send requests with POST to /messages?sessionId=<id>

3. Health Check
   Endpoint: /health
   Method: GET
==============================================
`);
  });
}

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');

  // Close all active transports
  for (const sessionId in transports) {
    try {
      console.log(`Closing transport for session ${sessionId}`);
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }

  console.log('Server shutdown complete');
  process.exit(0);
});

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
