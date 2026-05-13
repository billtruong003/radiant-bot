export type CultivationRankId =
  | 'pham_nhan'
  | 'luyen_khi'
  | 'truc_co'
  | 'kim_dan'
  | 'nguyen_anh'
  | 'hoa_than'
  | 'luyen_hu'
  | 'hop_the'
  | 'dai_thua'
  | 'do_kiep'
  | 'tien_nhan';

export type XpSource =
  | 'message'
  | 'voice'
  | 'voice_working'
  | 'reaction'
  | 'pin'
  | 'daily'
  | 'streak_7'
  | 'streak_14'
  | 'streak_30'
  | 'solved'
  | 'event'
  | 'tribulation_pass'
  | 'tribulation_fail'
  | 'admin_grant';

export interface User extends Record<string, unknown> {
  discord_id: string;
  username: string;
  display_name: string | null;
  xp: number;
  level: number;
  cultivation_rank: CultivationRankId;
  sub_title: string | null;
  joined_at: number;
  verified_at: number | null;
  last_message_at: number | null;
  last_daily_at: number | null;
  daily_streak: number;
  is_suspect: boolean;
  notes: string | null;
}

export interface XpLog extends Record<string, unknown> {
  id: string;
  discord_id: string;
  amount: number;
  source: XpSource;
  metadata: Record<string, unknown> | null;
  created_at: number;
}

export interface VoiceSession extends Record<string, unknown> {
  discord_id: string;
  channel_id: string;
  joined_at: number;
  is_working: boolean;
}

export interface Verification extends Record<string, unknown> {
  discord_id: string;
  challenge_type: 'math' | 'image+math';
  challenge_data: { expected: string; [k: string]: unknown };
  attempts: number;
  started_at: number;
  status: 'pending' | 'passed' | 'failed' | 'timeout';
}

export interface AutomodLog extends Record<string, unknown> {
  id: string;
  discord_id: string;
  rule: 'spam' | 'profanity' | 'mass_mention' | 'link' | 'caps';
  action: 'delete' | 'warn' | 'timeout' | 'kick' | 'ban';
  context: Record<string, unknown> | null;
  created_at: number;
}

export interface SectEvent extends Record<string, unknown> {
  id: string;
  name: string;
  type: 'tribulation' | 'sect_war' | 'alchemy' | 'custom';
  started_at: number;
  ended_at: number | null;
  metadata: Record<string, unknown> | null;
}

export interface RaidState extends Record<string, unknown> {
  is_active: boolean;
  activated_at: number | null;
  last_join_at: number | null;
  recent_joins: number[];
}

export interface ReactionRoleMapping {
  emoji: string;
  role_name: string;
  [k: string]: unknown;
}

export interface ReactionRolesConfig extends Record<string, unknown> {
  message_id: string | null;
  channel_id: string | null;
  mappings: ReactionRoleMapping[];
}

export interface AkiCallLog extends Record<string, unknown> {
  id: string;
  discord_id: string;
  question_length: number;
  has_image: boolean;
  tokens_in: number;
  tokens_out: number;
  cached_tokens: number;
  cost_usd: number;
  refusal: boolean;
  refusal_reason: string | null;
  created_at: number;
}
