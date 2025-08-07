export interface FathomMeeting {
  title: string;
  meeting_title: string;
  url: string;
  share_url: string;
  created_at: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  recording_start_time?: string;
  recording_end_time?: string;
  meeting_type: 'all' | 'internal' | 'external';
  transcript_language?: string;
  calendar_invitees: string[];
  recorded_by: string;
  transcript?: string;
  default_summary?: string;
  action_items?: string[];
  crm_matches?: any[];
}

export interface FathomListMeetingsParams {
  calendar_invitees?: string[];
  calendar_invitees_domains?: string[];
  created_after?: string;
  created_before?: string;
  cursor?: string;
  include_crm_matches?: boolean;
  include_transcript?: boolean;
  meeting_type?: 'all' | 'internal' | 'external';
  recorded_by?: string[];
  teams?: string[];
}

export interface FathomListMeetingsResponse {
  items: FathomMeeting[];
  limit: number;
  next_cursor?: string;
}