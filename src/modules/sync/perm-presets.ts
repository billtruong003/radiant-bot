import { type OverwriteData, OverwriteType, PermissionsBitField } from 'discord.js';
import type { PermPreset } from '../../config/server-structure.js';

const F = PermissionsBitField.Flags;

/**
 * Permission bundles used across presets.
 */
const READ = F.ViewChannel | F.ReadMessageHistory;
const SEND = F.SendMessages | F.SendMessagesInThreads | F.AddReactions | F.EmbedLinks;
const FULL_TEXT = READ | SEND;
const MANAGE_TEXT = F.ManageMessages | F.ManageThreads | F.PinMessages;
const MOD_TEXT = FULL_TEXT | MANAGE_TEXT | F.MuteMembers | F.MoveMembers;
const ADMIN_TEXT = MOD_TEXT | F.ManageChannels | F.ManageRoles;

const VOICE_CONNECT = F.Connect | F.Speak | F.UseVAD;

/**
 * Map of role-name → permissions bit-or'd together. The caller resolves
 * names to role IDs via the synced role map.
 */
export interface PresetBundle {
  /** allow for @everyone (omit to leave @everyone untouched) */
  everyoneAllow?: bigint;
  /** deny for @everyone (most common — hide channel from default) */
  everyoneDeny?: bigint;
  /** per role-name: allow bits */
  allow: Record<string, bigint>;
  /** per role-name: deny bits */
  deny: Record<string, bigint>;
}

/**
 * All cultivation rank role names + Tiên Nhân (admin-grant top rank). Phase 2
 * sync treats them as a single "verified cultivator" cohort for channel access.
 */
const CULTIVATION_ROLE_NAMES = [
  'Phàm Nhân',
  'Luyện Khí',
  'Trúc Cơ',
  'Kim Đan',
  'Nguyên Anh',
  'Hóa Thần',
  'Luyện Hư',
  'Hợp Thể',
  'Đại Thừa',
  'Độ Kiếp',
  'Tiên Nhân',
] as const;

const STAFF_MOD = 'Chấp Pháp'; // renamed from Nội Môn Đệ Tử
const STAFF_ELDER = 'Trưởng Lão'; // senior advisor — supermod
const STAFF_SECT_MASTER = 'Chưởng Môn'; // top admin — full manage
const UNVERIFIED = 'Chưa Xác Minh';
// Thiên Đạo (bot's flair role) is intentionally NOT referenced in channel
// presets — the bot's effective permissions come from its managed role
// (Administrator in dev). Phase 9 audit will move bot perms onto this role
// and drop Administrator from the managed role.

function allowFor(names: readonly string[], bits: bigint): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const n of names) out[n] = bits;
  return out;
}

const PRESETS: Record<PermPreset, PresetBundle> = {
  // Verified members can see; nobody (except staff) posts. Chưa Xác Minh
  // is explicitly denied so a new member sees ONLY #verify until they
  // pass the gate (Bill's "chỉ thấy verify" policy, Phase 11).
  public_read: {
    everyoneAllow: READ,
    allow: {
      [STAFF_MOD]: FULL_TEXT | MANAGE_TEXT,
      [STAFF_ELDER]: FULL_TEXT | MANAGE_TEXT,
      [STAFF_SECT_MASTER]: ADMIN_TEXT,
    },
    deny: {
      [UNVERIFIED]: READ,
    },
  },

  // Verified members can see + post. Same Chưa Xác Minh deny rationale.
  public_full: {
    everyoneAllow: FULL_TEXT,
    allow: {
      [STAFF_MOD]: FULL_TEXT | MANAGE_TEXT,
      [STAFF_ELDER]: FULL_TEXT | MANAGE_TEXT,
      [STAFF_SECT_MASTER]: ADMIN_TEXT,
    },
    deny: {
      [UNVERIFIED]: READ,
    },
  },

  // Hidden from @everyone & Chưa Xác Minh; cultivators + voice access.
  verified_full: {
    everyoneDeny: READ,
    allow: {
      ...allowFor(CULTIVATION_ROLE_NAMES, FULL_TEXT | VOICE_CONNECT),
      [STAFF_MOD]: FULL_TEXT | MANAGE_TEXT | VOICE_CONNECT,
      [STAFF_ELDER]: MOD_TEXT | VOICE_CONNECT,
      [STAFF_SECT_MASTER]: ADMIN_TEXT | VOICE_CONNECT,
    },
    deny: {
      [UNVERIFIED]: READ,
    },
  },

  // Cultivators can view but not post (announcements / leaderboard).
  verified_read: {
    everyoneDeny: READ,
    allow: {
      ...allowFor(CULTIVATION_ROLE_NAMES, READ),
      [STAFF_MOD]: FULL_TEXT | MANAGE_TEXT,
      [STAFF_ELDER]: FULL_TEXT | MANAGE_TEXT,
      [STAFF_SECT_MASTER]: ADMIN_TEXT,
    },
    deny: {
      [UNVERIFIED]: READ,
    },
  },

  // Only Chưa Xác Minh + staff (for monitoring).
  unverified_only: {
    everyoneDeny: READ,
    allow: {
      [UNVERIFIED]: FULL_TEXT,
      [STAFF_MOD]: READ | MANAGE_TEXT,
      [STAFF_ELDER]: READ | MANAGE_TEXT,
      [STAFF_SECT_MASTER]: ADMIN_TEXT,
    },
    deny: {
      // Cultivators explicitly denied so they never see the captcha channel.
      ...allowFor(CULTIVATION_ROLE_NAMES, READ),
    },
  },

  // Mod-only channels (bot-dev etc). Elder is supermod → access too.
  mod_only: {
    everyoneDeny: READ,
    allow: {
      [STAFF_MOD]: FULL_TEXT | MANAGE_TEXT,
      [STAFF_ELDER]: FULL_TEXT | MANAGE_TEXT,
      [STAFF_SECT_MASTER]: ADMIN_TEXT,
    },
    deny: {
      [UNVERIFIED]: READ,
      ...allowFor(CULTIVATION_ROLE_NAMES, READ),
    },
  },

  // Admin-only (elder-lounge). Both Trưởng Lão (elder) + Chưởng Môn read+post;
  // Chưởng Môn additionally has manage perms. Mod is denied.
  admin_only: {
    everyoneDeny: READ,
    allow: {
      [STAFF_ELDER]: FULL_TEXT | MANAGE_TEXT,
      [STAFF_SECT_MASTER]: ADMIN_TEXT,
    },
    deny: {
      [UNVERIFIED]: READ,
      ...allowFor([...CULTIVATION_ROLE_NAMES, STAFF_MOD], READ),
    },
  },

  // Bot-only post channel (sect log). Staff can read; Elder + Master can
  // manage entries (pin / delete spam) but the channel is bot-write only.
  bot_log: {
    everyoneDeny: READ,
    allow: {
      [STAFF_MOD]: READ,
      [STAFF_ELDER]: READ | MANAGE_TEXT,
      [STAFF_SECT_MASTER]: READ | MANAGE_TEXT,
    },
    deny: {
      [UNVERIFIED]: READ,
      ...allowFor(CULTIVATION_ROLE_NAMES, READ),
    },
  },
};

export interface ResolveContext {
  everyoneRoleId: string;
  /** Maps role name → role ID. Roles not in the map are silently skipped. */
  roleByName: ReadonlyMap<string, { id: string }>;
}

/**
 * Resolves a preset into a list of permission overwrites ready for
 * `channel.permissionOverwrites.set([...])`. Missing roles (e.g. preset
 * references Trưởng Lão but role doesn't exist yet) are silently skipped —
 * sync should be ordered roles-first to avoid this case.
 */
export function resolveOverwrites(preset: PermPreset, ctx: ResolveContext): OverwriteData[] {
  const bundle = PRESETS[preset];
  const overwrites: OverwriteData[] = [];

  // @everyone bucket.
  if (bundle.everyoneAllow !== undefined || bundle.everyoneDeny !== undefined) {
    overwrites.push({
      id: ctx.everyoneRoleId,
      type: OverwriteType.Role,
      allow: bundle.everyoneAllow ?? 0n,
      deny: bundle.everyoneDeny ?? 0n,
    });
  }

  // Per-role allow/deny — merge allow and deny for the same role into a
  // single overwrite (Discord requires unique role IDs in the overwrites
  // list, otherwise the API rejects with 50035).
  const merged = new Map<string, { allow: bigint; deny: bigint }>();
  for (const [name, bits] of Object.entries(bundle.allow)) {
    const role = ctx.roleByName.get(name);
    if (!role) continue;
    const cur = merged.get(role.id) ?? { allow: 0n, deny: 0n };
    cur.allow |= bits;
    merged.set(role.id, cur);
  }
  for (const [name, bits] of Object.entries(bundle.deny)) {
    const role = ctx.roleByName.get(name);
    if (!role) continue;
    const cur = merged.get(role.id) ?? { allow: 0n, deny: 0n };
    cur.deny |= bits;
    merged.set(role.id, cur);
  }
  for (const [id, { allow, deny }] of merged) {
    overwrites.push({ id, type: OverwriteType.Role, allow, deny });
  }

  return overwrites;
}
