import { type Client, Room } from '@colyseus/core';
import { ArraySchema } from '@colyseus/schema';
import { z } from 'zod';
import { verifyToken } from '../auth/tokens.js';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { roomCounter } from '../pending-rooms.js';
import {
  DuelState,
  PlayerSchema,
  WeaponSchema,
  WeaponSkillSchema,
  WeaponStatsSchema,
  WeaponVisualSchema,
} from './schemas.js';

/**
 * Lát D.2 — DuelRoom lifecycle skeleton.
 *
 * Owns: state hydration from bot-supplied options, HMAC auth on join,
 * per-player connection flag, capacity slot release on dispose.
 *
 * Does NOT yet handle: ready/shoot/animation_complete messages, turn timers,
 * physics, result POST back to bot — those land in Lát D.4-D.6.
 */

const WeaponStatsOptSchema = z
  .object({
    power: z.number().default(1.0),
    hitbox: z.number().default(1.0),
    bounce: z.number().default(0.5),
    damage_base: z.number().default(20),
    pierce_count: z.number().int().min(0).default(0),
    crit_chance: z.number().min(0).max(1).default(0),
    crit_multi: z.number().default(1.5),
  })
  .default({});

const WeaponVisualOptSchema = z
  .object({
    model_prefab_key: z.string().default(''),
    particle_fx_key: z.string().default(''),
    trail_fx_key: z.string().default(''),
    hue: z.string().default('#ffffff'),
  })
  .default({});

const WeaponSkillOptSchema = z.object({
  skill_id: z.string(),
  trigger: z.string().default('passive'),
  magnitude: z.number().default(0),
  cooldown: z.number().default(0),
  fx_key: z.string().default(''),
});

const WeaponOptSchema = z.object({
  slug: z.string().min(1),
  display_name: z.string(),
  category: z.enum(['blunt', 'pierce', 'spirit']),
  tier: z.enum(['ban_menh', 'pham', 'dia', 'thien', 'tien']),
  stats: WeaponStatsOptSchema,
  visual: WeaponVisualOptSchema,
  skills: z.array(WeaponSkillOptSchema).default([]),
});

const PlayerOptSchema = z.object({
  discord_id: z.string().min(1),
  display_name: z.string(),
  available_weapons: z.array(WeaponOptSchema).default([]),
});

export const CreateOptionsSchema = z.object({
  session_id: z.string().min(1),
  stake: z.number().int().min(0).default(0),
  join_deadline_at: z.number().int().positive(),
  players: z.array(PlayerOptSchema).length(2),
});

export type CreateOptions = z.infer<typeof CreateOptionsSchema>;
type WeaponOpt = z.infer<typeof WeaponOptSchema>;

function buildWeaponSchema(w: WeaponOpt): WeaponSchema {
  const ws = new WeaponSchema();
  ws.slug = w.slug;
  ws.display_name = w.display_name;
  ws.category = w.category;
  ws.tier = w.tier;

  const stats = new WeaponStatsSchema();
  stats.power = w.stats.power;
  stats.hitbox = w.stats.hitbox;
  stats.bounce = w.stats.bounce;
  stats.damage_base = w.stats.damage_base;
  stats.pierce_count = w.stats.pierce_count;
  stats.crit_chance = w.stats.crit_chance;
  stats.crit_multi = w.stats.crit_multi;
  ws.stats = stats;

  const visual = new WeaponVisualSchema();
  visual.model_prefab_key = w.visual.model_prefab_key;
  visual.particle_fx_key = w.visual.particle_fx_key;
  visual.trail_fx_key = w.visual.trail_fx_key;
  visual.hue = w.visual.hue;
  ws.visual = visual;

  ws.skills = new ArraySchema<WeaponSkillSchema>();
  for (const s of w.skills) {
    const skill = new WeaponSkillSchema();
    skill.skill_id = s.skill_id;
    skill.trigger = s.trigger;
    skill.magnitude = s.magnitude;
    skill.cooldown = s.cooldown;
    skill.fx_key = s.fx_key;
    ws.skills.push(skill);
  }
  return ws;
}

export class DuelRoom extends Room<DuelState> {
  static readonly MAX_PLAYERS = 2;

  override onCreate(rawOptions: unknown): void {
    const parsed = CreateOptionsSchema.safeParse(rawOptions);
    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, 'duel-room: invalid create options, disposing');
      this.disconnect();
      return;
    }
    const options = parsed.data;

    this.maxClients = DuelRoom.MAX_PLAYERS;
    this.autoDispose = true;

    const state = new DuelState();
    state.session_id = options.session_id;
    state.stake = options.stake;
    state.join_deadline_at = options.join_deadline_at;
    state.phase = 'waiting';

    for (const p of options.players) {
      const player = new PlayerSchema();
      player.discord_id = p.discord_id;
      player.display_name = p.display_name;
      player.hp = 100;
      player.hp_max = 100;
      for (const w of p.available_weapons) {
        player.available_weapons.push(buildWeaponSchema(w));
      }
      player.connected = false;
      state.players.set(p.discord_id, player);
    }

    this.setState(state);

    logger.info(
      {
        session_id: options.session_id,
        players: options.players.map((p) => p.discord_id),
        stake: options.stake,
      },
      'duel-room: created',
    );
  }

  override onAuth(_client: Client, options: { token?: string }): { discord_id: string } {
    const payload = options?.token ? verifyToken(options.token, env.ARENA_TOKEN_SECRET) : null;
    if (!payload) {
      throw new Error('invalid or expired token');
    }
    if (payload.session_id !== this.state.session_id) {
      throw new Error('token session mismatch');
    }
    if (!this.state.players.has(payload.discord_id)) {
      throw new Error('discord_id not in room roster');
    }
    return { discord_id: payload.discord_id };
  }

  override onJoin(client: Client, _options: unknown, auth?: { discord_id: string }): void {
    if (!auth?.discord_id) {
      // onAuth would have thrown before this; defensive guard.
      return;
    }
    client.userData = { discord_id: auth.discord_id };
    const p = this.state.players.get(auth.discord_id);
    if (!p) return;
    p.connected = true;

    if (this.state.phase === 'waiting') {
      this.state.phase = 'lobby';
    }

    logger.info(
      { session_id: this.state.session_id, discord_id: auth.discord_id },
      'duel-room: player joined',
    );
  }

  override onLeave(client: Client, consented: boolean): void {
    const userData = client.userData as { discord_id?: string } | undefined;
    const discordId = userData?.discord_id;
    if (!discordId) return;
    const p = this.state.players.get(discordId);
    if (!p) return;
    p.connected = false;

    logger.info(
      { session_id: this.state.session_id, discord_id: discordId, consented },
      'duel-room: player left',
    );
    // Disconnect-grace + forfeit-on-dropout handled in Lát D.4.
  }

  override onDispose(): void {
    roomCounter.release();
    logger.info(
      {
        session_id: this.state?.session_id ?? '',
        outcome: this.state?.outcome ?? '',
        slots_remaining: env.MAX_CONCURRENT_ROOMS - roomCounter.count(),
      },
      'duel-room: disposed',
    );
  }
}
