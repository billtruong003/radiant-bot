import type { CongPhap, Weapon } from '../../db/types.js';
import type { DuelRound } from './duel.js';

/**
 * Layer 2 static-template combat narration. Pure function, deterministic
 * given the same DuelRound + fighter context. Generates prose lines for
 * /duel embed — replaces the previous numeric "Hiệp X: ⚔️ A −DMG · 🛡️ B −DMG"
 * dump with cultivation-themed micro-narrative per round.
 *
 * Layer 3 (LLM full story) will be added later as opt-in; Layer 2 is
 * always-on and zero-cost. Reproducibility matters because /duel uses a
 * seeded RNG — the same seed must replay identical prose.
 */

export interface FighterDisplay {
  name: string;
  /**
   * Weapon name + category. null when fighter has no weapon equipped — narrator
   * falls back to `vũ khí trần` (bare-hand) phrasing.
   */
  weapon: Pick<Weapon, 'display_name' | 'category' | 'tier'> | null;
  /**
   * Equipped công pháp name + school. null when nothing equipped — narrator
   * skips school flavor.
   */
  congPhap: Pick<CongPhap, 'name' | 'icon' | 'school'> | null;
}

/** Verb bank keyed by weapon category. Picked deterministically by round idx. */
const WEAPON_VERBS: Record<'blunt' | 'pierce' | 'spirit' | 'bare', readonly string[]> = {
  blunt: ['vung', 'đập', 'trảm xuống', 'chấn tới', 'quét ngang'],
  pierce: ['đâm', 'chém', 'trảm', 'xé ngang', 'phóng kiếm khí'],
  spirit: ['phóng linh khí', 'khắc phù vào không khí', 'bắn châu linh', 'điều khí công kích'],
  bare: ['tung quyền', 'đẩy chưởng', 'vung tay', 'đả khí công'],
};

/** Short flavor inserted mid-line based on công pháp school. */
const SCHOOL_FLAVOR: Record<string, string> = {
  kiem_phap: 'kiếm khí xé không gian',
  than_phap: 'thân hình lướt như khói',
  noi_cong: 'nội khí ngùn ngụt',
  luyen_the: 'thân thể đá tảng vững vàng',
  phap_thuat: 'phù trận xoay vần',
  am_duong: 'âm dương chuyển vị',
  ngu_hanh: 'ngũ hành xoay tròn',
  thien_ma: 'thiên ma chi khí dậy',
  tuyen_sinh: 'sinh tử khí giao thoa',
};

function pickVerb(weaponCat: string | null, idx: number): string {
  const key =
    weaponCat === 'blunt' || weaponCat === 'pierce' || weaponCat === 'spirit' ? weaponCat : 'bare';
  const arr = WEAPON_VERBS[key];
  return arr[idx % arr.length] ?? arr[0] ?? 'tấn công';
}

function flavor(school: string | undefined): string {
  if (!school) return '';
  return SCHOOL_FLAVOR[school] ?? '';
}

function weaponLabel(d: FighterDisplay): string {
  if (!d.weapon) return 'vũ khí trần';
  return d.weapon.display_name;
}

function attackerLine(
  attacker: FighterDisplay,
  defender: FighterDisplay,
  damage: number,
  hpAfter: number,
  crit: boolean,
  defended: boolean,
  roundIdx: number,
): string {
  const aName = `**${attacker.name}**`;
  const dName = defender.name;
  const wpn = weaponLabel(attacker);
  const verb = pickVerb(attacker.weapon?.category ?? null, roundIdx);
  const icon = attacker.congPhap?.icon ?? '';
  const flv = flavor(attacker.congPhap?.school);
  const flvPart = flv ? `, ${flv}` : '';

  if (defended) {
    return `🛡️ ${aName} ${verb} ${wpn}${flvPart} — ${dName} thủ chắn, hấp thụ một phần, −${damage} HP _(còn ${hpAfter})_`;
  }
  if (crit) {
    return `⚡ ${aName} ${verb} ${wpn} ${icon}${flvPart} — **CHÍ MẠNG!** ${dName} trúng đòn nặng −${damage} HP _(còn ${hpAfter})_`;
  }
  return `⚔️ ${aName} ${verb} ${wpn} ${icon}${flvPart} — ${dName} đỡ không kịp, −${damage} HP _(còn ${hpAfter})_`;
}

/**
 * Render one prose line per round. Returns an array the caller can join
 * with `\n` into the duel embed description. Always exactly `rounds.length`
 * entries (one per simulated round).
 *
 * Each round emits TWO sub-lines (challenger attack, opponent attack)
 * separated by `  ·  ` — Bill wants to see both sides per round, not a
 * single combined summary.
 */
export function narrateRounds(
  rounds: readonly DuelRound[],
  challenger: FighterDisplay,
  opponent: FighterDisplay,
): string[] {
  return rounds.map((r) => {
    const cLine = attackerLine(
      challenger,
      opponent,
      r.challengerDamage,
      r.opponentHpAfter,
      r.challengerCrit,
      r.opponentDefended,
      r.round - 1,
    );
    const oLine = attackerLine(
      opponent,
      challenger,
      r.opponentDamage,
      r.challengerHpAfter,
      r.opponentCrit,
      r.challengerDefended,
      r.round - 1,
    );
    return `**Hiệp ${r.round}**\n${cLine}\n${oLine}`;
  });
}

/**
 * Miểu sát narration — used when rank gap ≥ 2 triggers an instant-kill.
 * Returns prose lines for the embed description. Captures the "cảnh giới
 * chênh lệch quá lớn — không thể chống đỡ" theme via the winner's công
 * pháp + weapon names.
 */
export function narrateMieuSat(
  challenger: FighterDisplay,
  opponent: FighterDisplay,
  rankGap: number,
  cRankName: string,
  oRankName: string,
): string[] {
  const cWpn = weaponLabel(challenger);
  const cCp = challenger.congPhap
    ? `${challenger.congPhap.icon ?? ''} ${challenger.congPhap.name}`
    : 'khí thế tự thân';
  const flv = flavor(challenger.congPhap?.school);
  const flvLine = flv
    ? `${cCp} — ${flv} — đối thủ chỉ thấy bóng trắng lướt qua.`
    : `${cCp} bùng — đối thủ chỉ thấy bóng trắng lướt qua.`;

  return [
    `**${challenger.name}** _(${cRankName})_ bước tới — **${opponent.name}** _(${oRankName})_ chưa kịp rút ${weaponLabel(opponent)}.`,
    `Cảnh giới chênh lệch **${rankGap} tầng** — khí áp đè bẹp trước khi chiêu kịp ra.`,
    flvLine,
    `${cWpn} chỉ cần lướt qua không khí. **${opponent.name}** hộc máu, ngã.`,
    '',
    `🌑 **MIỂU SÁT** — ${challenger.name} thắng, không màng đan dược của kẻ yếu.`,
  ];
}

export const __for_testing = { WEAPON_VERBS, SCHOOL_FLAVOR, pickVerb, flavor };
