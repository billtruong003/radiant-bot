import { z } from 'zod';
import { env } from '../../config/env.js';
import { getStore } from '../../db/index.js';
import type { Hunter, HunterProfile } from '../../db/types.js';

const STAT_CODES = ['STR', 'AGI', 'INT', 'VIT', 'LUK', 'CHA'] as const;

const awakenSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  level: z.number(),
  overall: z.object({ rank: z.string(), percentile: z.number() }),
  class: z.object({ name: z.string(), element: z.string() }),
  title: z.string().nullable(),
  stats: z
    .array(
      z.object({
        code: z.enum(STAT_CODES),
        source: z.string(),
        value: z.number(),
        rank: z.string(),
        percentile: z.number(),
      }),
    )
    .length(6),
  syncedAt: z.string(),
});

/** A stored profile older than this is fetched again when the card is shown. */
export const PROFILE_TTL_MS = 24 * 3600 * 1000;
/** /hunter refresh at most once an hour per member. */
export const REFRESH_COOLDOWN_MS = 3600 * 1000;

export async function fetchHunterProfile(login: string): Promise<HunterProfile> {
  const res = await fetch(
    `${env.AWAKEN_API_URL}/api/hunter?username=${encodeURIComponent(login)}`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) throw new Error(`Git Profile Awaken answered ${res.status}`);
  const data = awakenSchema.parse(await res.json());
  return {
    login: data.login,
    name: data.name,
    level: data.level,
    overall: data.overall,
    class: data.class,
    title: data.title,
    stats: data.stats,
    synced_at: data.syncedAt,
  };
}

export type LinkResult = { ok: true; hunter: Hunter } | { ok: false; reason: 'taken'; by: string };

/** Links a verified GitHub account to a member. One GitHub account belongs to one member. */
export async function linkHunter(
  discordId: string,
  github: { login: string; id: number },
  now = Date.now(),
): Promise<LinkResult> {
  const store = getStore();
  const owner = store.hunters
    .all()
    .find((h) => h.github_id === github.id && h.discord_id !== discordId);
  if (owner) return { ok: false, reason: 'taken', by: owner.discord_id };
  const previous = store.hunters.get(discordId);
  const keepRecord = previous?.github_id === github.id;
  const profile = await fetchHunterProfile(github.login).catch(() => null);
  const hunter: Hunter = {
    discord_id: discordId,
    github_login: github.login,
    github_id: github.id,
    linked_at: keepRecord ? previous.linked_at : now,
    profile,
    fetched_at: profile ? now : 0,
    duel_wins: keepRecord ? previous.duel_wins : 0,
    duel_losses: keepRecord ? previous.duel_losses : 0,
  };
  await store.hunters.set(hunter);
  return { ok: true, hunter };
}

/** The member's hunter with a profile no older than a day; keeps the old one if Awaken is down. */
export async function freshHunter(
  discordId: string,
  force = false,
  now = Date.now(),
): Promise<Hunter | null> {
  const store = getStore();
  const hunter = store.hunters.get(discordId);
  if (!hunter) return null;
  if (!force && hunter.profile && now - hunter.fetched_at < PROFILE_TTL_MS) return hunter;
  try {
    const profile = await fetchHunterProfile(hunter.github_login);
    const current = store.hunters.get(discordId) ?? hunter;
    const updated = { ...current, profile, fetched_at: now };
    await store.hunters.set(updated);
    return updated;
  } catch {
    return hunter;
  }
}
