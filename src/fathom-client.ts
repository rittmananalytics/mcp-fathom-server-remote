import axios, { AxiosInstance, AxiosError } from 'axios';
import { FathomListMeetingsParams, FathomListMeetingsResponse, FathomMeeting } from './types.js';

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
    // For now, just get recent meetings without transcripts for performance
    // Transcripts can make responses over 1MB which is too slow
    const response = await this.listMeetings({
      include_transcript: false,
      created_after: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // Last 30 days
    });
    
    const searchLower = searchTerm.toLowerCase();
    const filteredMeetings = response.items.filter(meeting => {
      const titleMatch = meeting.title?.toLowerCase().includes(searchLower) || 
                        meeting.meeting_title?.toLowerCase().includes(searchLower);
      const summaryMatch = meeting.default_summary?.toLowerCase().includes(searchLower);
      const actionItemsMatch = meeting.action_items?.some(item => 
        typeof item === 'string' && item.toLowerCase().includes(searchLower)
      );
      
      return titleMatch || summaryMatch || actionItemsMatch;
    });
    
    // If we need transcripts, fetch them individually for just the matching meetings
    if (includeTranscript && filteredMeetings.length > 0 && filteredMeetings.length <= 5) {
      // Only fetch transcripts for up to 5 meetings to avoid timeouts
      console.error(`Fetching transcripts for ${filteredMeetings.length} meetings...`);
      // Note: This would require individual meeting fetch API which Fathom doesn't seem to provide
      // So we'll return without transcripts for now
    }
    
    return filteredMeetings;
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
      if (!key.includes('calendar_invitees') && !key.includes('recorded_by') && !key.includes('teams') && value !== undefined) {
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