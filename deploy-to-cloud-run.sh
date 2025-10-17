#!/bin/bash
set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-ra-development}"
SERVICE_NAME="${SERVICE_NAME:-mcp-fathom-server}"
REGION="${REGION:-us-central1}"
SECRET_NAME="${SECRET_NAME:-fathom-api-key}"

# Check if FATHOM_API_KEY is set
if [ -z "$FATHOM_API_KEY" ]; then
    echo "Error: FATHOM_API_KEY environment variable is not set"
    echo "Please set it before running this script:"
    echo "  export FATHOM_API_KEY=your-api-key-here"
    echo "  ./deploy-to-cloud-run.sh"
    exit 1
fi

echo "=========================================="
echo "Deploying MCP Fathom Server v2.0.0 to Cloud Run"
echo "Project: $PROJECT_ID"
echo "Service: $SERVICE_NAME"
echo "Region: $REGION"
echo "=========================================="
echo ""

# Step 1: Set the project
echo "Step 1: Setting GCP project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# Step 2: Enable required APIs
echo ""
echo "Step 2: Enabling required Google Cloud APIs..."
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com
gcloud services enable secretmanager.googleapis.com

# Step 3: Check if secret exists, create if not
echo ""
echo "Step 3: Setting up Secret Manager..."
if gcloud secrets describe $SECRET_NAME --project=$PROJECT_ID &>/dev/null; then
    echo "Secret '$SECRET_NAME' already exists. Updating..."
    echo -n "$FATHOM_API_KEY" | gcloud secrets versions add $SECRET_NAME --data-file=-
else
    echo "Creating new secret '$SECRET_NAME'..."
    echo -n "$FATHOM_API_KEY" | gcloud secrets create $SECRET_NAME \
        --data-file=- \
        --replication-policy=automatic
fi

# Step 4: Grant Cloud Run service account access to the secret
echo ""
echo "Step 4: Granting Cloud Run access to secret..."
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
SERVICE_ACCOUNT="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

gcloud secrets add-iam-policy-binding $SECRET_NAME \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor" \
    --project=$PROJECT_ID || echo "Permission already granted"

# Step 5: Deploy to Cloud Run
echo ""
echo "Step 5: Deploying to Cloud Run (this may take 2-3 minutes)..."
echo "Features: Transcript search, AI summarization, webhooks, team management"
gcloud run deploy $SERVICE_NAME \
    --source . \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --set-secrets=FATHOM_API_KEY=$SECRET_NAME:latest \
    --port 8080 \
    --memory 1Gi \
    --cpu 1 \
    --timeout 300 \
    --max-instances 10 \
    --min-instances 0 \
    --concurrency 80

# Step 6: Get the service URL
echo ""
echo "Step 6: Getting service URL..."
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
    --region $REGION \
    --format 'value(status.url)')

echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Service URL: $SERVICE_URL"
echo "MCP Endpoint: $SERVICE_URL/mcp"
echo "SSE Endpoint: $SERVICE_URL/sse"
echo "Health Check: $SERVICE_URL/health"
echo ""
echo "Testing health endpoint..."
curl -s $SERVICE_URL/health | jq . || curl -s $SERVICE_URL/health
echo ""
echo ""
echo "=========================================="
echo "Next Steps:"
echo "=========================================="
echo "1. Add to Claude.ai:"
echo "   - Go to Settings → MCP Servers"
echo "   - Add Remote Server"
echo "   - URL: $SERVICE_URL/mcp"
echo ""
echo "2. Test with MCP Inspector:"
echo "   npx @modelcontextprotocol/inspector"
echo "   - Select HTTP transport"
echo "   - Enter URL: $SERVICE_URL/mcp"
echo ""
echo "3. Available Tools (v2.0.0):"
echo "   - list_meetings: List meetings with filters"
echo "   - search_meetings: Search with transcript support"
echo "   - get_meeting_transcript: Fetch individual transcripts"
echo "   - list_teams: List all teams"
echo "   - list_team_members: List team members"
echo "   - create_webhook: Create real-time webhooks"
echo "   - delete_webhook: Delete webhooks"
echo ""
echo "4. View logs:"
echo "   gcloud run services logs read $SERVICE_NAME --region $REGION --limit 50"
echo ""
echo "5. Update deployment:"
echo "   export FATHOM_API_KEY=your-key"
echo "   ./deploy-to-cloud-run.sh"
echo ""
echo "=========================================="
