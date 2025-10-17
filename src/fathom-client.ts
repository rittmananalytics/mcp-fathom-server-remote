import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  FathomListMeetingsParams,
  FathomListMeetingsResponse,
  FathomMeeting,
  FathomListTeamsResponse,
  FathomListTeamMembersParams,
  FathomListTeamMembersResponse,
  FathomCreateWebhookParams,
  FathomCreateWebhookResponse,
  FathomDeleteWebhookParams
} from './types.js';

export class FathomClient {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Fathom API key is required');
    }
    
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: 'https://api.fathom.ai/external/v1',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  async listMeetings(params?: FathomListMeetingsParams): Promise<FathomListMeetingsResponse> {
    try {
      const response = await this.client.get<FathomListMeetingsResponse>('/meetings', {
        params: this.formatParams(params)
      });
      
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async searchMeetings(searchTerm: string, includeTranscript: boolean = false): Promise<FathomMeeting[]> {
    const searchLower = searchTerm.toLowerCase();

    // Fetch recent meetings
    const response = await this.listMeetings({
      include_transcript: false,
      created_after: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // Last 30 days
    });

    // If transcript search is enabled, fetch transcripts for ALL meetings (up to limit)
    if (includeTranscript) {
      const maxTranscripts = 10; // Limit to avoid timeouts
      const meetingsToSearch = response.items.slice(0, maxTranscripts);
      const meetingsWithRecordingId = meetingsToSearch.filter(m => m.recording_id);

      console.error(`[SEARCH] Searching transcripts for ${meetingsWithRecordingId.length}/${meetingsToSearch.length} meetings with recording IDs...`);

      // Track success/failure counts
      let successCount = 0;
      let skipCount = 0;
      let errorCount = 0;

      // Fetch transcripts in parallel for all meetings
      const transcriptPromises = meetingsWithRecordingId.map(async meeting => {
        if (meeting.recording_id) {
          try {
            const transcript = await this.getMeetingTranscript(meeting.recording_id);
            if (transcript) {
              meeting.transcript = transcript;
              successCount++;
            } else {
              skipCount++;
            }
          } catch (error) {
            errorCount++;
            console.error(`[ERROR] Failed to fetch transcript for recording ${meeting.recording_id}:`,
              error instanceof Error ? error.message : 'Unknown error');
            // Critical errors (auth, rate limit) will throw and stop the search
            throw error;
          }
        }
        return meeting;
      });

      await Promise.all(transcriptPromises);

      console.error(`[SEARCH] Transcript fetch results: ${successCount} successful, ${skipCount} skipped, ${errorCount} errors`);

      // Filter meetings that match in EITHER metadata OR transcript
      return meetingsToSearch.filter(meeting => {
        const titleMatch = meeting.title?.toLowerCase().includes(searchLower) ||
                          meeting.meeting_title?.toLowerCase().includes(searchLower);
        const summaryMatch = meeting.default_summary?.toLowerCase().includes(searchLower);
        const actionItemsMatch = meeting.action_items?.some(item =>
          typeof item === 'string' && item.toLowerCase().includes(searchLower)
        );
        const transcriptMatch = meeting.transcript?.toLowerCase().includes(searchLower);

        return titleMatch || summaryMatch || actionItemsMatch || transcriptMatch;
      });
    }

    // If transcript search is NOT enabled, only search metadata
    return response.items.filter(meeting => {
      const titleMatch = meeting.title?.toLowerCase().includes(searchLower) ||
                        meeting.meeting_title?.toLowerCase().includes(searchLower);
      const summaryMatch = meeting.default_summary?.toLowerCase().includes(searchLower);
      const actionItemsMatch = meeting.action_items?.some(item =>
        typeof item === 'string' && item.toLowerCase().includes(searchLower)
      );

      return titleMatch || summaryMatch || actionItemsMatch;
    });
  }

  async getMeetingTranscript(recordingId: string): Promise<string> {
    try {
      const response = await this.client.get(`/recordings/${recordingId}/transcript`);

      // Handle Fathom's actual API structure: { transcript: [ { speaker: {...}, text: "...", timestamp: "..." }, ... ] }
      if (response.data && Array.isArray(response.data.transcript)) {
        // Convert array of transcript segments to plain text
        const transcriptText = response.data.transcript
          .map((segment: any) => {
            const speaker = segment.speaker?.display_name || 'Unknown Speaker';
            const time = segment.timestamp || '';
            const text = segment.text || '';
            return `[${time}] ${speaker}: ${text}`;
          })
          .join('\n');

        console.error(`[INFO] Fetched transcript for ${recordingId}: ${transcriptText.length} chars, ${response.data.transcript.length} segments`);
        return transcriptText;
      }

      // Fallback: handle if it's a simple string
      if (typeof response.data === 'string') {
        return response.data;
      }

      if (response.data && typeof response.data.transcript === 'string') {
        return response.data.transcript;
      }

      // Log unexpected structure for debugging
      console.error(`[WARNING] Unexpected transcript response for ${recordingId}:`,
        JSON.stringify(response.data).substring(0, 500));
      throw new Error(`Unexpected transcript response structure for recording ${recordingId}`);

    } catch (error) {
      if (error instanceof AxiosError) {
        // Handle specific error codes
        if (error.response?.status === 404) {
          // Transcript doesn't exist yet (meeting might be processing)
          console.error(`[INFO] Transcript not available for recording ${recordingId} (404)`);
          return '';
        }
        if (error.response?.status === 401 || error.response?.status === 403) {
          // Auth issue - this is serious, throw it
          throw new Error(`Authentication error accessing transcript ${recordingId}: ${error.response.status}`);
        }
        if (error.response?.status === 429) {
          // Rate limit - throw to stop hammering the API
          throw new Error(`Rate limit exceeded while fetching transcript ${recordingId}`);
        }
      }

      // For other errors, log and skip this transcript
      console.error(`[ERROR] Failed to fetch transcript for ${recordingId}:`,
        error instanceof Error ? error.message : 'Unknown error');
      return '';
    }
  }

  async listTeams(): Promise<FathomListTeamsResponse> {
    try {
      const response = await this.client.get<FathomListTeamsResponse>('/teams');
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async listTeamMembers(params: FathomListTeamMembersParams): Promise<FathomListTeamMembersResponse> {
    try {
      const response = await this.client.get<FathomListTeamMembersResponse>(`/teams/${params.team_id}/members`, {
        params: params.cursor ? { cursor: params.cursor } : undefined
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async createWebhook(params: FathomCreateWebhookParams): Promise<FathomCreateWebhookResponse> {
    try {
      const response = await this.client.post<FathomCreateWebhookResponse>('/webhooks', params);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async deleteWebhook(params: FathomDeleteWebhookParams): Promise<void> {
    try {
      await this.client.delete(`/webhooks/${params.webhook_id}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private formatParams(params?: FathomListMeetingsParams): Record<string, any> {
    if (!params) return {};
    
    const formatted: Record<string, any> = {};
    
    if (params.calendar_invitees?.length) {
      formatted['calendar_invitees[]'] = params.calendar_invitees;
    }
    if (params.calendar_invitees_domains?.length) {
      formatted['calendar_invitees_domains[]'] = params.calendar_invitees_domains;
    }
    if (params.recorded_by?.length) {
      formatted['recorded_by[]'] = params.recorded_by;
    }
    if (params.teams?.length) {
      formatted['teams[]'] = params.teams;
    }
    
    Object.entries(params).forEach(([key, value]) => {
      // Exclude array parameters already handled and include_transcript (not supported by API)
      if (!key.includes('calendar_invitees') &&
          !key.includes('recorded_by') &&
          !key.includes('teams') &&
          key !== 'include_transcript' &&  // Don't send to API - we fetch transcripts separately
          value !== undefined) {
        formatted[key] = value;
      }
    });
    
    return formatted;
  }

  private handleError(error: unknown): Error {
    if (error instanceof AxiosError) {
      if (error.response?.status === 429) {
        return new Error('Rate limit exceeded. Please try again later.');
      }
      if (error.response?.status === 401) {
        return new Error('Invalid API key. Please check your Fathom API key.');
      }
      if (error.response?.data?.message) {
        return new Error(`Fathom API error: ${error.response.data.message}`);
      }
    }
    
    return error instanceof Error ? error : new Error('Unknown error occurred');
  }
}