/**
 * Phase 13 Lát C — Vietnamese-language short descriptions for every skill_id
 * used in the weapon catalog + bản mệnh forge. Consumed by `/arena inspect`
 * and `/arena catalog` to render skill lines in Discord embeds.
 *
 * When the server-side `skills.ts` engine ships (separate Lát), it consumes
 * the SAME skill_ids to wire actual gameplay effects. This module is the
 * authoritative source of player-facing skill copy.
 */

export interface SkillDescription {
  /** Short Vietnamese name (e.g. "Phong Mạch"). */
  name: string;
  /** One-line gameplay description (Vietnamese). */
  short: string;
  /** Single emoji icon for embed prefix. */
  icon: string;
}

export const SKILL_DESCRIPTIONS: Record<string, SkillDescription> = {
  // ─── Catalog passives — on_hit ────────────────────────────────────────────
  passive_corner_combo_15: {
    name: 'Chấn Góc',
    short: 'Đập trúng góc tường: +15% sát thương',
    icon: '💥',
  },
  passive_lifesteal_10: {
    name: 'Hút Máu',
    short: 'Hồi 10% sát thương gây ra',
    icon: '🩸',
  },
  passive_freeze_miss_30: {
    name: 'Đông Cứng',
    short: '30% xác suất đối thủ trượt lượt kế',
    icon: '❄️',
  },
  passive_thunder_chain: {
    name: 'Lôi Liên',
    short: '20% phóng tia điện phụ nửa sát thương sang góc khác',
    icon: '⚡',
  },
  passive_armor_break: {
    name: 'Phá Hộ',
    short: 'Đối thủ bounce −25% trong 1 lượt',
    icon: '🛡️',
  },
  passive_soul_taint: {
    name: 'Linh Tà',
    short: '15% dây stack linh tà; 3 stacks → đối thủ trượt + cấm hồi',
    icon: '👻',
  },

  // ─── Catalog passives — on_crit ───────────────────────────────────────────
  passive_pierce_through: {
    name: 'Xuyên Phá',
    short: 'Crit: lượt bắn này được +1 pierce_count',
    icon: '🗡️',
  },
  passive_soul_drain: {
    name: 'Hút Hồn',
    short: 'Crit: hồi 20% sát thương về tu sĩ',
    icon: '💀',
  },
  passive_armor_pierce_dia: {
    name: 'Xé Vân',
    short: 'Crit: giảm 50% bounce của đối thủ',
    icon: '☁️',
  },

  // ─── Catalog passives — on_round_start ────────────────────────────────────
  passive_burning_path: {
    name: 'Hỏa Lộ',
    short: 'Đầu lượt: bắn line lửa 5 sát thương, cháy 4 giây',
    icon: '🔥',
  },

  // ─── Catalog passives — conditional (on_low_hp + on_hit-with-victim-hp-check)
  passive_executioner: {
    name: 'Trảm Tàn',
    short: '+50% sát thương nếu đối thủ <30% hp',
    icon: '⚔️',
  },
  passive_iron_will: {
    name: 'Bất Khuất',
    short: 'Khi tu sĩ <30% hp: uy lực +25%',
    icon: '🛡️',
  },

  // ─── Catalog active signatures (cd-based) ─────────────────────────────────
  signature_thiet_phien_quet: {
    name: 'Phong Vũ Quét',
    short: 'Active · cd 8s · arc rộng 1.8×',
    icon: '🌪️',
  },
  signature_le_bang_freeze_pulse: {
    name: 'Lệ Băng Trận',
    short: 'Active · cd 10s · AoE freeze 2.2×',
    icon: '❄️',
  },
  signature_thunder_drop: {
    name: 'Thiên Lôi Trảo',
    short: 'Active · cd 9s · vertical strike 1.9×',
    icon: '⚡',
  },
  signature_world_break: {
    name: 'Diệt Thế',
    short: 'Active · cd 12s · xuyên tường 2.5×',
    icon: '💥',
  },
  signature_immortal_slash: {
    name: 'Trảm Linh',
    short: 'Active · cd 11s · phantom skip giữa đường 2.8×',
    icon: '👁️',
  },
  signature_mass_freeze: {
    name: 'Vạn Hồn Phá',
    short: 'Active · cd 14s · 3-fragment spread 2.6×',
    icon: '👻',
  },

  // ─── Bản mệnh skills (forge.ts pickBanMenhSkill) ──────────────────────────
  ban_menh_phong_mach: {
    name: 'Phong Mạch',
    short: 'Phát đầu mỗi trận +30% sát thương',
    icon: '🌬️',
  },
  ban_menh_huyet_mach: {
    name: 'Huyết Mạch',
    short: 'Hồi 5 sinh lực mỗi lượt khởi đầu',
    icon: '🩸',
  },
  ban_menh_loi_mach: {
    name: 'Lôi Mạch',
    short: 'Base tỷ lệ chí mạng +5%',
    icon: '⚡',
  },
  ban_menh_kim_mach: {
    name: 'Kim Mạch',
    short: 'Uy lực +10%, độ nảy −10% (xu hướng xuyên)',
    icon: '⚔️',
  },
  ban_menh_moc_mach: {
    name: 'Mộc Mạch',
    short: 'Mỗi 2 lượt cộng 1 stack "mộc khí"; 3 stacks hồi 15 hp',
    icon: '🌿',
  },
};

export function describeSkill(skillId: string): SkillDescription | null {
  return SKILL_DESCRIPTIONS[skillId] ?? null;
}
