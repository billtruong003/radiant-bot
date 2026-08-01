import type { LlmFilterStage } from '../modules/llm/types.js';

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
  | 'admin_grant'
  // Phase 14 — markers for danh hiệu lifetime counters. Amount is the XP
  // earned from the action (or 0 if none); the row exists primarily so
  // title award scans can count lifetime duel_win + mieu_sat events.
  | 'duel_win'
  | 'mieu_sat';

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
  /**
   * Phase 11 B3: timestamp when Aki posted the first-message welcome
   * react (🌟 + "Tân đệ tử nhập môn"). null = greeting not yet sent;
   * non-null = already greeted, one-shot done. Optional for back-compat
   * with users persisted before this field existed.
   */
  first_message_greeted_at?: number | null;
  // --- Phase 12 game mechanics (Lát 1 foundation) ---------------------
  /** Pills (Đan dược độ kiếp) — currency required for tribulation attempts. */
  pills?: number;
  /** Soft currency earned from activity, spent at the shop. */
  contribution_points?: number;
  /**
   * @deprecated Phase 14 round 3 — replaced by `equipped_cong_phap_slugs`
   * (array, up to 3 slots). Kept on the type so old snapshots replay clean
   * and a fall-back read can wrap the single slug into a 1-element array.
   */
  equipped_cong_phap_slug?: string | null;
  /**
   * Phase 14 round 3 — multi-slot công pháp equip. Up to 3 slots; slot
   * unlock thresholds gated by cultivation rank (slot 2 at Trúc Cơ, slot
   * 3 at Hóa Thần). Each entry is a slug owned in `userCongPhap`. Duplicate
   * slugs rejected at equip-time.
   */
  equipped_cong_phap_slugs?: string[] | null;
  /** Timestamp of the most recent daily quest the cron assigned. */
  last_quest_assigned_at?: number | null;
  /**
   * Phase 12 — Server boost reward tracking. Set on the first null→set
   * premium transition we observe; lets us detect a re-boost (after an
   * unboost) and skip duplicate reward grants.
   */
  premium_boosted_at_ms?: number | null;
  /**
   * Phase 12 B7 — User opted in to having Aki remember their previous
   * /ask questions across calls. Defaults false. When true, AkiCallLog
   * stores question_text for this user; client.ts reads last 3 and
   * embeds in Grok system prompt for continuity.
   */
  aki_memory_opt_in?: boolean;
  /**
   * Phase 13 Lát A — slug of the arena weapon currently equipped, or null.
   * Distinct from `equipped_cong_phap_slug` (công pháp is leveling buff;
   * weapon is PvP arena gear). Optional for back-compat with snapshots
   * predating the arena bridge.
   */
  equipped_weapon_slug?: string | null;
  // --- Phase 14 V2 — multi-slot equipment ---------------------------
  /** Slug of the pháp khí (magic treasure) currently equipped, or null. Single slot. */
  equipped_phap_khi_slug?: string | null;
  /** Up to 2 nhẫn (rings) equipped. Each entry is a slug from nhan_catalog. */
  equipped_ring_slugs?: string[] | null;
  // --- Phase 14 — Stat allocation + item upgrade --------------------
  /**
   * Unspent stat points the user has accumulated. Granted at level-up
   * (+2/level per Phase 14 design). Spent via /stat-alloc to bump
   * `stat_alloc.*` categories. Optional + back-compat: lazy-migrate
   * to `level × 2` on first /stat-alloc access for users predating
   * Phase 14.
   */
  stat_points_unspent?: number;
  /**
   * User-allocated stat distribution. Each category contributes to the
   * lực-chiến formula in `combat/power.ts`. Trade-off design: all-dmg
   * builds big damage but no HP; balanced builds survive longer. Reset
   * is free via /stat-alloc reset → refunds total into stat_points_unspent.
   */
  stat_alloc?: {
    /** Damage flat add — +8 LC per point. */
    dmg: number;
    /** Hit-point pool — +5 LC per point (proxies survivability into LC). */
    hp: number;
    /** Damage reduction — +3 LC per point. */
    def: number;
    /** Crit chance + initiative — +4 LC per point. */
    spd: number;
  };
  /**
   * Tracks the last level we awarded stat points for, so we don't double-grant
   * on bot restart / WAL replay. null/undefined = never granted (lazy-migrate
   * picks user.level on next interaction).
   */
  stat_points_granted_for_level?: number | null;
  /**
   * Phase 14 — equipped honor title (danh hiệu). Distinct from `sub_title`
   * which is a self-chosen archetype role (Kiếm Tu/Đan Sư/...); a danh hiệu
   * is achievement-earned and shown in /stat as a flair line. References
   * `id` from the static TITLES catalog in `src/config/titles.ts`. null =
   * none equipped.
   */
  equipped_title_id?: string | null;
}

/**
 * Phase 14 — earned honor title ownership row. One row per (user, title_id).
 * Tracked separately from user record so we can index by title (leaderboards,
 * "first to earn X") without scanning users.
 */
export interface UserTitle extends Record<string, unknown> {
  id: string;
  discord_id: string;
  title_id: string;
  earned_at: number;
}

/**
 * Phase 15 — inferred knowledge about a member, distilled from their
 * recent public messages by a free model.
 *
 * Deliberately stores only the DISTILLED profile, never the raw messages:
 * raw chat is fetched from Discord at analysis time and discarded. That
 * keeps this collection tiny (one bounded row per member) and avoids
 * recreating the unbounded-growth problem that xp_logs had.
 *
 * Treat every field as a GUESS made by a small model from a limited
 * window — it is decision support for the sect leaders, not fact.
 */
export interface MemberProfile extends Record<string, unknown> {
  /** Keyed by discord_id — one living profile per member, updated in place. */
  discord_id: string;
  username: string;
  display_name: string | null;
  /** 2-3 sentence character sketch, Vietnamese. */
  summary: string;
  /** Topics they gravitate to. */
  interests: string[];
  /** How they talk (e.g. "ngắn gọn, hay đùa", "lịch sự, hỏi nhiều"). */
  tone: string;
  /** Things they appear to know well. */
  expertise: string[];
  /** How many messages backed this inference — low count = low confidence. */
  messages_analyzed: number;
  updated_at: number;

  // --- Group standing, captured at inference time -----------------------
  // These are FACTS read from Discord + the store, not model guesses. They
  // are snapshotted next to the sketch so a profile answers "who is this?"
  // on its own without re-joining against users/roles, and so the model is
  // told up front whether it is describing a sect leader or a brand-new
  // member — which changes what the summary should emphasise.
  /** Discord role names held at inference time (staff + cultivation + flair). */
  roles?: string[];
  /** True if they hold a staff role (Chưởng Môn / Trưởng Lão / Chấp Pháp). */
  is_staff?: boolean;
  /** Display name of their cultivation rank, e.g. "Hóa Thần". */
  cultivation_rank_name?: string;
  /** Level at inference time — pairs with rank to show how far along they are. */
  level?: number;
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
  /**
   * Phase 11 A2: per-user verify thread ID (when DM was blocked and we
   * fell back to a thread in #verify). Null = either DM succeeded OR
   * verification predates the feature. Lets cleanup cron delete the
   * thread on pass/fail/timeout.
   */
  fallback_thread_id?: string | null;
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
  /** Grok-stage tokens (0 if filter rejected before Grok was called). */
  tokens_in: number;
  tokens_out: number;
  cached_tokens: number;
  /** Grok-stage cost. Excludes filter cost — see filter_cost_usd. */
  cost_usd: number;
  refusal: boolean;
  refusal_reason: string | null;
  created_at: number;
  /**
   * Filter-stage (Gemini Flash) cost + tokens, since Phase 10 chunk 7.
   * Optional for backward-compat with logs written before the field
   * existed. Values default to 0 / null in code that reads them.
   *
   * `filter_stage`:
   *   - 'gemini'      → Gemini call succeeded, used its verdict
   *   - 'pre-filter'  → local heuristic caught it, no Gemini call
   *   - 'fail-open'   → Gemini errored, fell through to Grok
   *   - 'disabled'    → GEMINI_API_KEY not set
   *   - null          → pre-filter era log
   */
  filter_stage?: LlmFilterStage | null;
  filter_tokens_in?: number;
  filter_tokens_out?: number;
  filter_cost_usd?: number;
  /** True if filter rejected and Grok was NOT called. */
  filter_rejected?: boolean;
  /**
   * Phase 12 B7 — question text. ONLY stored when the user has opted
   * in via `User.aki_memory_opt_in`. Default null (back-compat + privacy
   * default). Used by client.ts to feed recent question history into
   * Grok system prompt for continuity. Bounded to 500 chars.
   */
  question_text?: string | null;
  /**
   * Lát 5 (2026-07-31) — Aki's answer, stored under the SAME opt-in and
   * privacy rules as question_text. Bounded to 300 chars. Without it the
   * memory block taught Aki what was asked but not what she said, so
   * "continuity" was one-sided.
   */
  reply_text?: string | null;
}

// ============================================================================
// Phase 12 — Game mechanics entities (Lát 1 foundation)
// ============================================================================

export type CongPhapRarity = 'common' | 'rare' | 'epic' | 'legendary';

/**
 * Cultivation school / lineage for a công pháp. Lets shop UI group/filter
 * and lets passive effects target by school (e.g. "Hỏa Long Phiến +50 CP
 * when equipped with Hỏa Long Chưởng" — both are phap_thuat school).
 */
export type CongPhapSchool =
  | 'kiem_phap' // Kiếm Pháp — sword techniques
  | 'than_phap' // Thân Pháp — movement/agility
  | 'noi_cong' // Nội Công — internal energy
  | 'luyen_the' // Luyện Thể — body tempering
  | 'phap_thuat' // Pháp Thuật — spell arts
  | 'am_duong' // Âm Dương — yin-yang balance
  | 'ngu_hanh' // Ngũ Hành — five elements
  | 'thien_ma' // Thiên Ma — demonic arts
  | 'tuyen_sinh'; // Tuyền Sinh — life cultivation

/**
 * Catalog entry for a công pháp (cultivation technique manual). Read-mostly:
 * seeded from a config JSON at startup, mutable only via admin slash later.
 * Indexed by `slug` (stable identifier referenced by UserCongPhap).
 *
 * Phase 14 V2: added `icon`, `school`, `lore`, `passive_text` for richer
 * shop UI + lore-heavy display. All four are optional in the type for
 * snapshot back-compat (old catalogs replayed from disk lack them), but
 * the JSON catalog source-of-truth always provides them.
 */
export interface CongPhap extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  description: string;
  rarity: CongPhapRarity;
  cost_pills: number;
  cost_contribution: number;
  stat_bonuses: {
    combat_power: number;
    xp_multiplier?: number;
    pill_discount?: number;
  };
  min_rank_required: CultivationRankId | null;
  created_at: number;
  // --- V2 fields (optional for snapshot back-compat) -----------------
  icon?: string;
  school?: CongPhapSchool;
  lore?: string;
  passive_text?: string;
}

/**
 * A user's owned copy of a công pháp. Equip state lives on User —
 * `User.equipped_cong_phap_slug` points at the slug of their currently
 * equipped manual.
 *
 * Phase 14 V2: added `level` (0..10) for the Cường Hóa upgrade system.
 * Optional for back-compat — callers read as `(ownership.level ?? 0)`.
 */
export interface UserCongPhap extends Record<string, unknown> {
  id: string;
  discord_id: string;
  cong_phap_slug: string;
  acquired_at: number;
  level?: number;
}

// ============================================================================
// Phase 14 V2 — Pháp Khí (magic treasure) — single-slot equipment
// ============================================================================

export type PhapKhiRarity = 'rare' | 'epic' | 'legendary' | 'tien_khi';

export type PhapKhiType =
  | 'kiem' // kiếm — sword
  | 'truc' // trượng/trục — staff/needle
  | 'canh' // chuông/khánh — bell/chime
  | 'dinh' // đỉnh/lư — cauldron
  | 'phan' // phiến — fan
  | 'bao'; // other treasure

export interface PhapKhiStatBonuses {
  combat_power: number;
  xp_multiplier?: number;
  pill_discount?: number;
  /** Flat bonus damage applied in Arena Unity duels (server authoritative). */
  duel_damage_bonus?: number;
}

/**
 * Catalog entry for a pháp khí. Only ONE pháp khí can be equipped per user
 * (User.equipped_phap_khi_slug). Seeded from `phap-khi-catalog.json` at
 * startup, keyed by slug. Stat bonuses stack with công pháp + nhẫn into
 * the V2 combat power formula.
 */
export interface PhapKhi extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  icon: string;
  type: PhapKhiType;
  description: string;
  lore: string;
  passive_text: string;
  rarity: PhapKhiRarity;
  cost_pills: number;
  cost_contribution: number;
  stat_bonuses: PhapKhiStatBonuses;
  min_rank_required: CultivationRankId | null;
  /** Optional decorative emoji shown around avatar in profile (e.g. '🔥'). */
  visual_aura?: string | null;
  created_at: number;
}

/**
 * A user's owned pháp khí instance. Equip state lives on User. `level`
 * 0..10 controlled by the Cường Hóa upgrade system.
 */
export interface UserPhapKhi extends Record<string, unknown> {
  id: string;
  discord_id: string;
  phap_khi_slug: string;
  acquired_at: number;
  level?: number;
}

// ============================================================================
// Phase 14 V2 — Nhẫn (rings) — up to 2 slots
// ============================================================================

export type NhanRarity = 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface NhanStatBonuses {
  combat_power: number;
  xp_multiplier?: number;
  pill_discount?: number;
}

/**
 * Catalog entry for a nhẫn (ring). Up to 2 can be equipped concurrently
 * via `User.equipped_ring_slugs`. Same slug cannot be equipped twice (one
 * instance per slot enforced at equip time).
 */
export interface Nhan extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  icon: string;
  description: string;
  lore: string;
  rarity: NhanRarity;
  cost_pills: number;
  cost_contribution: number;
  stat_bonuses: NhanStatBonuses;
  min_rank_required: CultivationRankId | null;
  created_at: number;
}

export interface UserNhan extends Record<string, unknown> {
  id: string;
  discord_id: string;
  nhan_slug: string;
  acquired_at: number;
  level?: number;
}

export type DailyQuestType =
  | 'message_count'
  | 'voice_minutes'
  | 'reaction_count'
  | 'daily_streak_check'
  // Phase 14 expansion — engagement quests beyond passive activity.
  | 'duel_win'
  | 'spend_contribution'
  | 'upgrade_attempt'
  | 'equip_both'
  | 'tribulation_pass';

/**
 * Phase 14 V2 — probabilistic item drop attached to a quest. Rolled when
 * the quest is marked completed. Multiple entries are independent rolls
 * (one quest can drop several items in theory; in practice tiers contain
 * 1–3 entries). See `src/modules/quests/drop-roller.ts`.
 */
export interface QuestItemDrop {
  item_type: 'cong_phap' | 'phap_khi' | 'nhan';
  slug: string;
  /** 0..1 — independent roll probability. */
  probability: number;
}

// ============================================================================
// Phase 12 Lát 9 — Docs threads pipeline
// ============================================================================

export type DocContributionStatus = 'pending' | 'approved' | 'rejected';
export type DocDifficulty = 'easy' | 'medium' | 'hard';
export type DocSource = 'slash' | 'api';

/**
 * User-submitted document/article. Created when a member runs
 * `/contribute-doc` or hits the `POST /api/contribute` HMAC endpoint.
 * Aki validates via LLM, classifies difficulty + tags + section, and
 * either approves (publish to forum thread) or rejects with reason.
 */
export interface DocContribution extends Record<string, unknown> {
  id: string;
  /** Discord thread id once created; null until publish step. */
  thread_id: string | null;
  /**
   * Optional image attached at submission. Stored as the Discord CDN URL
   * from the slash-command attachment. Optional (undefined for old rows
   * replayed from snapshot/WAL written before Phase 12.6/3 — preserved as
   * undefined rather than backfilled).
   */
  image_url?: string | null;
  author_id: string;
  title: string;
  /** Full body — capped 4000 chars at submission time. */
  body: string;
  status: DocContributionStatus;
  /** Combined LLM score 0-100. null until validated. */
  score: number | null;
  difficulty: DocDifficulty | null;
  /** Tags as plain string[]. Validated against the per-channel allowed list. */
  tags: string[];
  /** Section slug ('tech' | 'cultivation' | 'lore' | 'dev' | etc). */
  section: string | null;
  source: DocSource;
  /** Editor-friendly notes from the LLM judge — shown when status='rejected'. */
  rejection_reason: string | null;
  submitted_at: number;
  decided_at: number | null;
}

/**
 * Append-only review log — every LLM judgment attempt + cost. Lets Bill
 * audit / debug the validation pipeline without scraping the LLM router.
 */
export interface DocReviewLog extends Record<string, unknown> {
  id: string;
  contribution_id: string;
  llm_provider: string;
  llm_model: string;
  llm_tokens_in: number;
  llm_tokens_out: number;
  llm_cost_usd: number;
  raw_response: string;
  approved: boolean;
  created_at: number;
}

/**
 * Per-user daily quest. One quest is generated per active user at the
 * start of each VN day (cron 0 0 * * * Asia/Ho_Chi_Minh). Progress is
 * tracked incrementally; `completed_at` flips when `progress >= target`
 * and rewards are granted atomically.
 */
export interface DailyQuest extends Record<string, unknown> {
  id: string;
  discord_id: string;
  quest_type: DailyQuestType;
  target: number;
  progress: number;
  reward_xp: number;
  reward_pills: number;
  reward_contribution: number;
  assigned_at: number;
  completed_at: number | null;
  /**
   * Phase 14 V2 — optional item drop pool rolled on completion. Each entry
   * is an independent probability check. Null/undefined = no item drops
   * (old quests from before V2 + future quests that don't grant items).
   */
  reward_item_pool?: QuestItemDrop[] | null;
}

// ============================================================================
// Phase 13 Lát A — Radiant Arena weapon system + session log
// ============================================================================

export type WeaponCategory = 'blunt' | 'pierce' | 'spirit';
export type WeaponTier =
  | 'ban_menh'
  | 'pham'
  | 'dia'
  | 'thien'
  | 'tien'
  // Phase 14.4 — endgame tiers for Hóa Thần+ players. Each gates by
  // unlock_realm; visual icon distinguishes via TIER_ICON map.
  | 'thanh'
  | 'than'
  | 'huyen';

export interface WeaponStats {
  /** 1.0 - 1.4 — multiplier on shot kinetic energy. */
  power: number;
  /** 0.85 - 1.15 — collider radius multiplier. */
  hitbox: number;
  /** 0.35 - 0.65 — wall bounce coefficient (blunt only meaningful). */
  bounce: number;
  /** Base damage before crit/speed multipliers (server authoritative). */
  damage_base: number;
  /** 0 = blunt (bounce off players), 1+ = pierce through N players. */
  pierce_count: number;
  /** 0.0 - 1.0 — chance per shot. */
  crit_chance: number;
  /** Multiplier applied on crit. */
  crit_multi: number;
}

export interface WeaponSkillRef {
  skill_id: string;
  trigger: 'passive' | 'on_hit' | 'on_crit' | 'on_low_hp' | 'active' | 'on_round_start';
  magnitude: number;
  /** Seconds. 0 for passive. */
  cooldown: number;
  fx_key: string;
}

export interface WeaponVisual {
  model_prefab_key: string;
  particle_fx_key: string;
  trail_fx_key: string;
  /** Hex string, e.g. '#D4AF37'. */
  hue: string;
}

export interface WeaponShop {
  cost_pills: number;
  cost_contribution: number;
  /** Cultivation rank required to purchase; null = no gate. */
  unlock_realm: CultivationRankId | null;
}

/**
 * Arena weapon catalog entry. Stored in collection `weapon_catalog` keyed
 * by slug. Bản mệnh weapons (`tier = 'ban_menh'`) are NOT seeded — they're
 * forged deterministically per user from Discord ID hash and stored
 * directly via `userWeapons.set()` with the same slug pattern
 * `phap-khi-ban-menh-<discord_id>`.
 */
export interface Weapon extends Record<string, unknown> {
  slug: string;
  display_name: string;
  category: WeaponCategory;
  tier: WeaponTier;
  stats: WeaponStats;
  skills: WeaponSkillRef[];
  visual: WeaponVisual;
  lore: string;
  shop: WeaponShop | null;
  created_at: number;
}

/**
 * A user's owned weapon instance. For shop-purchased weapons, weapon_slug
 * references `weapon_catalog`. For bản mệnh, weapon_slug follows pattern
 * `phap-khi-ban-menh-<discord_id>` and stats live in `custom_stats`
 * (catalog lookup will miss). Equipped state is on User.equipped_weapon_slug.
 */
export interface UserWeapon extends Record<string, unknown> {
  id: string;
  discord_id: string;
  weapon_slug: string;
  /** Only set for bản mệnh weapons (not in catalog). null for catalog refs. */
  custom_stats: WeaponStats | null;
  /** Only set for bản mệnh weapons. null otherwise. */
  custom_visual: WeaponVisual | null;
  /**
   * Only set for bản mệnh weapons — 1-element array carrying the deterministic
   * skill rolled at forge time (from a fixed pool of 5 ban_menh skill IDs).
   * null for catalog weapon refs (skills resolved via catalog lookup).
   */
  custom_skills: WeaponSkillRef[] | null;
  acquired_at: number;
  /**
   * Phase 14 — Cường Hóa upgrade level 0..10. Each level multiplies the
   * weapon's contribution to LC by +15%. Optional for back-compat (default
   * 0 when undefined). Upgrade via /weapon upgrade with fail RNG (downgrade
   * at level ≥ 7 on fail; stay-put below).
   */
  level?: number;
}

export type ArenaSessionStatus = 'pending' | 'active' | 'ended';
export type ArenaOutcome = 'win' | 'timeout_join' | 'double_afk' | 'disconnect';

/**
 * Match record for a Colyseus duel. Bot creates row on /arena create,
 * Colyseus POSTs result to /api/arena/result which marks status='ended'
 * and applies stake transfer + xpLogs. Idempotent on session_id.
 */
export interface ArenaSession extends Record<string, unknown> {
  session_id: string;
  p1_id: string;
  p2_id: string;
  p1_weapon_slug: string;
  p2_weapon_slug: string;
  stake: number;
  status: ArenaSessionStatus;
  created_at: number;
  ended_at: number | null;
  outcome: ArenaOutcome | null;
  winner_id: string | null;
  rounds_played: number | null;
  /** Replay JSON serialized as string (capped 32KB at ingest). */
  trajectory_blob: string | null;
  replay_url: string | null;
}
