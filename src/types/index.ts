export type NotificationMode = 'savage' | 'awkward';

export interface Group {
  id: string;
  name: string;
  weekly_target: number;
  penalty_per_miss: number;
  mode: NotificationMode;
  created_by: string;
  invite_code: string;
  created_at: string;
}

export interface Member {
  id: string;
  group_id: string;
  user_id: string;
  role: 'admin' | 'member';
  display_name: string;
  joined_at: string;
}

export interface CheckIn {
  id: string;
  group_id: string;
  user_id: string;
  photo_url: string;
  checked_at: string;
  week_number: number;
  year: number;
  flagged: boolean;
  display_name?: string;
}

export interface Exemption {
  id: string;
  group_id: string;
  user_id: string;
  week_number: number;
  year: number;
  reason: 'military' | 'travel' | 'injury' | 'other';
  reason_detail?: string;
  reduced_target: number;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  display_name?: string;
}

export interface Penalty {
  id: string;
  group_id: string;
  user_id: string;
  week_number: number;
  year: number;
  missed_count: number;
  amount: number;
  finalized: boolean;
  display_name?: string;
}

export interface WeeklyStats {
  user_id: string;
  display_name: string;
  checkin_count: number;
  effective_target: number;
  penalty_amount: number;
}
