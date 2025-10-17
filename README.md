# Fathom MCP Server (Deployable to GCP Cloud Run)

[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Model Context Protocol (MCP) server that integrates with [Fathom AI](https://fathom.video)'s meeting platform, enabling Claude to search, analyze, and summarize your meeting transcripts through natural language queries.

## ✨ Features

- **🔍 Full Transcript Search**: Search within actual meeting transcripts (not just titles/summaries)
- **🤖 AI-Powered Summarization**: Let Claude automatically summarize meeting transcripts
- **📋 Meeting Management**: List and filter meetings by attendees, dates, teams, and more
- **👥 Team Operations**: Manage teams and team members
- **🔔 Real-time Webhooks**: Get notified when new meetings are ready
- **⚡ High Performance**: Parallel transcript fetching (up to 10 meetings)
- **☁️ Cloud-Ready**: Deploy locally (stdio) or remotely (HTTP) to Google Cloud Run
- **🌐 Multi-Platform**: Works with Claude Desktop, Claude.ai web, iOS, and Android

## 🚀 Quick Start

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- A Fathom AI account with API access
- Claude Desktop (for local use) OR Google Cloud account (for remote deployment)

### Local Installation (Claude Desktop)

1. **Clone and build**:
   ```bash
   git clone https://github.com/sourcegate/mcp-fathom-server.git
   cd mcp-fathom-server
   npm install
   npm run build
   ```

2. **Get your Fathom API key**:
   - Log in to [Fathom](https://app.fathom.video)
   - Go to Settings → API
   - Generate a new API key

3. **Configure Claude Desktop**:

   Edit your Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

   ```json
   {
     "mcpServers": {
       "fathom": {
         "command": "node",
         "args": ["/absolute/path/to/mcp-fathom-server/dist/index.js"],
         "env": {
           "FATHOM_API_KEY": "your-api-key-here"
         }
       }
     }
   }
   ```

4. **Restart Claude Desktop** and start asking about your meetings!

### Cloud Run Deployment

Deploy as a remote HTTP service for access from Claude.ai web and mobile:

1. **Set your API key**:
   ```bash
   export FATHOM_API_KEY=your-fathom-api-key-here
   ```

2. **Deploy to Cloud Run**:
   ```bash
   ./deploy-to-cloud-run.sh
   ```

3. **Add to Claude.ai**:
   - Go to [Claude.ai](https://claude.ai) → Settings → MCP Servers
   - Add Remote Server
   - URL: `https://your-service-url.run.app/mcp`

The script handles everything: enabling APIs, storing secrets, building, and deploying.

## 💬 Usage Examples

Once configured, ask Claude natural language questions:

```
"Find meetings about product strategy"
"What did we discuss in meetings with john@example.com last week?"
"Search transcripts for mentions of pricing changes"
"Summarize the transcript from our Q1 planning meeting"
"List all meetings from the engineering team"
"Who attended meetings about the new feature launch?"
```

## 🛠️ Available Tools

### `search_meetings`
Search meetings by keywords in titles, summaries, action items, AND full transcripts.

**Parameters:**
- `search_term`: Keyword/phrase to search for
- `include_transcript`: Search within transcripts (default: true, fetches up to 10)

**Example:** "Search for meetings where we discussed Claude Code"

### `list_meetings`
List meetings with optional filters.

**Parameters:**
- `calendar_invitees`: Filter by attendee emails
- `calendar_invitees_domains`: Filter by company domains
- `created_after`/`created_before`: Date range filters (ISO 8601)
- `meeting_type`: all, internal, or external
- `recorded_by`: Filter by meeting owner emails
- `teams`: Filter by team names
- `limit`: Maximum number to return (default: 50)

### `get_meeting_transcript`
Fetch the full transcript of a specific meeting.

**Parameters:**
- `recording_id`: The recording ID (from search results)
- `summarize`: Whether to prompt Claude to summarize (default: false)

### `list_teams`
List all teams accessible to the authenticated user.

### `list_team_members`
List members of a specific team.

**Parameters:**
- `team_id`: The team ID (from `list_teams`)

### `create_webhook`
Create a webhook for real-time meeting notifications.

**Parameters:**
- `url`: Webhook destination URL
- `include_transcript`: Include transcripts in payload (default: false)
- `include_summary`: Include summaries (default: true)
- `include_action_items`: Include action items (default: true)

Returns webhook ID and verification secret.

### `delete_webhook`
Remove an existing webhook.

**Parameters:**
- `webhook_id`: The webhook ID to delete

## 🏗️ Architecture

The server supports two operational modes:

**stdio Mode (Local)**
- For Claude Desktop
- Direct process communication
- Runs via `dist/index.js`

**HTTP Mode (Remote)**
- For Claude.ai web/mobile
- RESTful HTTP + Server-Sent Events
- Runs via `dist/http-server.js`
- Supports MCP protocol versions 2025-03-26 and 2024-11-05

Both modes share the same `FathomClient` core, ensuring consistent behavior.

## 🔧 Development

### Build and Test Locally

```bash
# Development mode (stdio)
npm run dev

# Build for production
npm run build

# Test with MCP Inspector
npx @modelcontextprotocol/inspector dist/index.js
```

### HTTP Server Development

```bash
# Development mode (HTTP)
npm run dev:http

# Test HTTP mode with Inspector
npm run test:http
# Navigate to http://localhost:5173
# Configure: Transport=HTTP, URL=http://localhost:8080/mcp
```

### Docker Testing

```bash
# Build image
docker build -t mcp-fathom-server .

# Run locally
docker run -p 8080:8080 -e FATHOM_API_KEY=your-key mcp-fathom-server

# Test health endpoint
curl http://localhost:8080/health
```

## 📊 API Response Handling

The server correctly handles Fathom's transcript API format:

**Fathom Transcript Structure:**
```json
{
  "transcript": [
    {
      "speaker": {
        "display_name": "John Doe",
        "matched_calendar_invitee_email": "john@example.com"
      },
      "text": "Let's discuss the new features",
      "timestamp": "00:00:05"
    }
  ]
}
```

**Converted to Searchable Text:**
```
[00:00:05] John Doe: Let's discuss the new features
[00:00:12] Jane Smith: I agree, we should prioritize...
```

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Server won't start** | Check `FATHOM_API_KEY` is set correctly |
| **No transcript results** | Ensure meetings have finished processing (transcripts aren't instant) |
| **Rate limiting** | Reduce concurrent transcript fetches or wait before retrying |
| **Claude can't find tools** | Restart Claude Desktop after config changes |
| **Empty search results** | Try broader search terms or check date range (searches last 30 days) |

### Viewing Logs

**Claude Desktop (macOS):**
```bash
tail -f ~/Library/Logs/Claude/mcp*.log
```

**Cloud Run:**
```bash
gcloud run services logs read mcp-fathom-server --region us-central1 --limit 50
```

## 🔒 Security

### Best Practices

- ✅ API keys stored in Secret Manager (Cloud Run) or environment variables (local)
- ✅ No API keys committed to version control
- ✅ HTTPS enforced on Cloud Run
- ✅ Rate limiting handled gracefully

### Production Deployment

For production Cloud Run deployments:

1. **Enable authentication**:
   ```bash
   gcloud run deploy mcp-fathom-server \
     --region us-central1 \
     --no-allow-unauthenticated
   ```

2. **Grant specific access**:
   ```bash
   gcloud run services add-iam-policy-binding mcp-fathom-server \
     --region us-central1 \
     --member="user:email@example.com" \
     --role="roles/run.invoker"
   ```

3. **Use Secret Manager** (deploy script does this automatically)

## 📝 Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `FATHOM_API_KEY` | Your Fathom API key | Yes | - |
| `PORT` | HTTP server port | No | 8080 |
| `NODE_ENV` | Environment mode | No | production |

## 🚢 Deployment Options

### Method 1: Automated Script (Recommended)

```bash
export FATHOM_API_KEY=your-key
./deploy-to-cloud-run.sh
```

Customization via environment variables:
```bash
export GCP_PROJECT_ID=my-project
export SERVICE_NAME=my-fathom-server
export REGION=us-west1
./deploy-to-cloud-run.sh
```

### Method 2: Manual gcloud

```bash
gcloud run deploy mcp-fathom-server \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-secrets=FATHOM_API_KEY=fathom-api-key:latest \
  --port 8080 \
  --memory 1Gi \
  --timeout 300
```

## 💰 Cost Optimization

Cloud Run pricing (auto-scales to zero):
- **Free tier**: 2 million requests/month
- **CPU/Memory**: Only charged during request processing
- **Expected personal use**: $0-5/month

Optimize costs:
```bash
gcloud run services update mcp-fathom-server \
  --region us-central1 \
  --min-instances 0 \
  --max-instances 5 \
  --memory 512Mi
```

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

For major changes, please open an issue first to discuss what you'd like to change.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built on the [Model Context Protocol](https://modelcontextprotocol.io)
- Integrates with [Fathom AI](https://fathom.video)
- Powered by [Anthropic's Claude](https://claude.ai)

## 📧 Support

- **Issues**: [GitHub Issues](https://github.com/sourcegate/mcp-fathom-server/issues)
- **Documentation**: [MCP Specification](https://modelcontextprotocol.io)
- **Fathom API**: [developers.fathom.ai](https://developers.fathom.ai)

---

**Version 2.0.0** | Built with ❤️ for the MCP community
