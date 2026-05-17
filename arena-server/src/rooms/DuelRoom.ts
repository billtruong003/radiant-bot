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
 * Lát D.4 — turn loop: select_weapon / ready / unready / shoot / animation_complete
 *           / concede / ping + state transitions
 *           lobby → countdown(3s) → active → animating → active → ... → ended.
 *
 * Owns: state hydration, HMAC auth, message handlers, server-authoritative
 * phase transitions, turn / animation / countdown / dispose timers. Capacity
 * slot release on dispose.
 *
 * Does NOT yet handle: physics (D.5 — `shoot` emits empty trajectory stub),
 * signature skills (D.7), result POST back to bot (D.6 — match_ended is
 * broadcast over WS but the HTTP callback is wired later).
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

// ─────────────────────────────────────────────────────────────────────────
// Lát D.4 — inbound message Zod schemas. One per client→server type.
// Server clamps angle + power on shoot; out-of-range silently coerced so
// malicious clients learn nothing about validation bounds.
// ─────────────────────────────────────────────────────────────────────────

const SelectWeaponPayload = z.object({ slug: z.string().min(1) });
const ReadyPayload = z.object({}).passthrough();
const UnreadyPayload = z.object({}).passthrough();
const ShootPayload = z.object({
  angle: z.number(),
  power: z.number(),
});
const AnimationCompletePayload = z.object({
  round: z.number().int().nonnegative(),
});
const ConcedePayload = z.object({}).passthrough();
const PingPayload = z.object({
  t: z.number(),
});
const SignaturePayload = z.object({}).passthrough();

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

/**
 * Loose type for `Colyseus.Clock.setTimeout` return value — its concrete
 * type lives in `@gamestdio/timer` which Colyseus re-exports indirectly.
 * We only need `.clear()`, so a structural type is enough.
 */
interface DelayedTimer {
  clear: () => void;
}

export class DuelRoom extends Room<DuelState> {
  static readonly MAX_PLAYERS = 2;

  /** Insertion order of players from CreateOptions; index 0 goes first. */
  private _slotOrder: string[] = [];

  /** Timers held for cancellation on state transitions / room dispose. */
  private _countdownTimer?: DelayedTimer;
  private _turnTimer?: DelayedTimer;
  private _animationTimer?: DelayedTimer;
  private _disposeTimer?: DelayedTimer;

  /**
   * Per-round set of discord_ids that have sent `animation_complete`.
   * Switch turn early when both players confirm; cleared on every new turn.
   */
  private _animationConfirmed = new Set<string>();

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

    this._slotOrder = options.players.map((p) => p.discord_id);

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
    this.registerMessageHandlers();

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
    this.clearAllTimers();
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

  // ───────────────────────────────────────────────────────────────────────
  // Lát D.4 — message handlers
  // ───────────────────────────────────────────────────────────────────────

  private registerMessageHandlers(): void {
    this.onMessage('select_weapon', (client, raw) => this.handleSelectWeapon(client, raw));
    this.onMessage('ready', (client, raw) => this.handleReady(client, raw));
    this.onMessage('unready', (client, raw) => this.handleUnready(client, raw));
    this.onMessage('shoot', (client, raw) => this.handleShoot(client, raw));
    this.onMessage('animation_complete', (client, raw) =>
      this.handleAnimationComplete(client, raw),
    );
    this.onMessage('concede', (client, raw) => this.handleConcede(client, raw));
    this.onMessage('ping', (client, raw) => this.handlePing(client, raw));
    this.onMessage('signature', (client, raw) => this.handleSignature(client, raw));
  }

  private discordIdOf(client: Client): string | null {
    const userData = client.userData as { discord_id?: string } | undefined;
    return userData?.discord_id ?? null;
  }

  private handleSelectWeapon(client: Client, raw: unknown): void {
    const parsed = SelectWeaponPayload.safeParse(raw);
    if (!parsed.success) return;
    if (this.state.phase !== 'lobby') return;
    const did = this.discordIdOf(client);
    if (!did) return;
    const player = this.state.players.get(did);
    if (!player) return;

    const slug = parsed.data.slug;
    let found = false;
    for (let i = 0; i < player.available_weapons.length; i++) {
      if (player.available_weapons[i]?.slug === slug) {
        found = true;
        break;
      }
    }
    if (!found) {
      client.send('error', { code: 'WEAPON_NOT_OWNED', slug });
      return;
    }
    player.selected_weapon_slug = slug;
    player.ready = false; // re-pick resets ready per spec
    logger.debug({ session_id: this.state.session_id, did, slug }, 'select_weapon');
  }

  private handleReady(client: Client, raw: unknown): void {
    if (!ReadyPayload.safeParse(raw).success) return;
    if (this.state.phase !== 'lobby') return;
    const did = this.discordIdOf(client);
    if (!did) return;
    const player = this.state.players.get(did);
    if (!player) return;

    if (!player.selected_weapon_slug) {
      client.send('error', { code: 'NO_WEAPON_SELECTED' });
      return;
    }
    player.ready = true;
    logger.debug({ session_id: this.state.session_id, did }, 'ready');

    // If both connected players are ready → start countdown.
    let allReady = true;
    let totalConnected = 0;
    for (const id of this._slotOrder) {
      const p = this.state.players.get(id);
      if (!p || !p.connected) continue;
      totalConnected += 1;
      if (!p.ready) allReady = false;
    }
    if (allReady && totalConnected === DuelRoom.MAX_PLAYERS) {
      this.startCountdown();
    }
  }

  private handleUnready(client: Client, raw: unknown): void {
    if (!UnreadyPayload.safeParse(raw).success) return;
    if (this.state.phase !== 'lobby' && this.state.phase !== 'countdown') return;
    const did = this.discordIdOf(client);
    if (!did) return;
    const player = this.state.players.get(did);
    if (!player) return;
    player.ready = false;
    logger.debug({ session_id: this.state.session_id, did }, 'unready');

    // If we were counting down, abort back to lobby.
    if (this.state.phase === 'countdown') {
      this.cancelCountdown();
    }
  }

  private handleShoot(client: Client, raw: unknown): void {
    const parsed = ShootPayload.safeParse(raw);
    if (!parsed.success) return;
    if (this.state.phase !== 'active') return;
    const did = this.discordIdOf(client);
    if (!did) return;
    if (this.state.turn_player_id !== did) return; // silent drop — not your turn

    // Clamp inputs (spec §2.3 — silent clamp, don't reveal bounds).
    const angle = clamp(parsed.data.angle, 0, Math.PI * 2);
    const power = clamp(parsed.data.power, 0, 1);

    logger.info(
      { session_id: this.state.session_id, did, angle, power, round: this.state.round },
      'shoot',
    );

    this.startAnimating(did, /* afk */ false, angle, power);
  }

  private handleAnimationComplete(client: Client, raw: unknown): void {
    const parsed = AnimationCompletePayload.safeParse(raw);
    if (!parsed.success) return;
    if (this.state.phase !== 'animating') return;
    const did = this.discordIdOf(client);
    if (!did) return;
    if (parsed.data.round !== this.state.round) return; // stale ack

    this._animationConfirmed.add(did);

    // Switch turn early when every connected player has confirmed.
    let connected = 0;
    let confirmed = 0;
    for (const id of this._slotOrder) {
      const p = this.state.players.get(id);
      if (!p || !p.connected) continue;
      connected += 1;
      if (this._animationConfirmed.has(id)) confirmed += 1;
    }
    if (confirmed >= connected) {
      this.advanceTurn();
    }
  }

  private handleConcede(client: Client, raw: unknown): void {
    if (!ConcedePayload.safeParse(raw).success) return;
    if (this.state.phase === 'waiting' || this.state.phase === 'ended') return;
    const did = this.discordIdOf(client);
    if (!did) return;
    const winnerId = this._slotOrder.find((id) => id !== did);
    if (!winnerId) return;
    logger.info({ session_id: this.state.session_id, did, winnerId }, 'concede');
    this.endMatch(winnerId, 'concede');
  }

  private handlePing(client: Client, raw: unknown): void {
    const parsed = PingPayload.safeParse(raw);
    if (!parsed.success) return;
    client.send('pong', { t: parsed.data.t, server_t: Date.now() });
  }

  private handleSignature(client: Client, raw: unknown): void {
    // D.7 will implement skill registry; for D.4 just acknowledge presence.
    if (!SignaturePayload.safeParse(raw).success) return;
    const did = this.discordIdOf(client);
    logger.debug({ session_id: this.state.session_id, did }, 'signature (D.7 stub)');
  }

  // ───────────────────────────────────────────────────────────────────────
  // Lát D.4 — state transitions
  // ───────────────────────────────────────────────────────────────────────

  private startCountdown(): void {
    if (this.state.phase !== 'lobby') return;
    this.state.phase = 'countdown';
    logger.info({ session_id: this.state.session_id }, 'phase: lobby → countdown');
    this._countdownTimer = this.clock.setTimeout(() => {
      this._countdownTimer = undefined;
      this.startActive();
    }, env.COUNTDOWN_MS);
  }

  private cancelCountdown(): void {
    if (this._countdownTimer) {
      this._countdownTimer.clear();
      this._countdownTimer = undefined;
    }
    if (this.state.phase === 'countdown') {
      this.state.phase = 'lobby';
      logger.info({ session_id: this.state.session_id }, 'phase: countdown → lobby (aborted)');
    }
  }

  private startActive(): void {
    // Lock weapons: clone each player's selected entry into PlayerSchema.weapon.
    for (const did of this._slotOrder) {
      const p = this.state.players.get(did);
      if (!p) continue;
      const slug = p.selected_weapon_slug;
      let pick: WeaponSchema | null = null;
      for (let i = 0; i < p.available_weapons.length; i++) {
        const w = p.available_weapons[i];
        if (w && w.slug === slug) {
          pick = w;
          break;
        }
      }
      if (pick) {
        p.weapon = cloneWeaponSchema(pick);
      }
    }
    this.state.phase = 'active';
    this.state.round = 1;
    const firstId = this._slotOrder[0] ?? '';
    logger.info(
      { session_id: this.state.session_id, first_turn: firstId },
      'phase: countdown → active',
    );
    this.broadcast('match_start', {
      first_turn_id: firstId,
      seed: Number((Date.now() >>> 0) ^ (this.state.session_id.length << 16)),
    });
    this.startTurn(firstId);
  }

  private startTurn(playerId: string): void {
    this.cancelTurnTimer();
    this.state.turn_player_id = playerId;
    this.state.turn_deadline_at = Date.now() + env.TURN_DEADLINE_MS;
    this._animationConfirmed.clear();
    this._turnTimer = this.clock.setTimeout(() => {
      this._turnTimer = undefined;
      logger.info(
        { session_id: this.state.session_id, did: playerId, round: this.state.round },
        'turn timeout — auto-advance',
      );
      this.startAnimating(playerId, /* afk */ true, 0, 0);
    }, env.TURN_DEADLINE_MS);
  }

  private cancelTurnTimer(): void {
    if (this._turnTimer) {
      this._turnTimer.clear();
      this._turnTimer = undefined;
    }
  }

  private startAnimating(shooterId: string, isAfk: boolean, angle: number, power: number): void {
    this.cancelTurnTimer();
    this.state.phase = 'animating';
    this.state.last_shooter_id = shooterId;
    this._animationConfirmed.clear();

    // D.4 stub physics — empty trajectory. D.5 will populate via real sim.
    if (!isAfk) {
      this.broadcast('shot_resolved', {
        trajectory: [],
        shooter: shooterId,
        damage_dealt: 0,
        crit: false,
        // Carry input back to clients for debugging; not used by playback yet.
        angle,
        power,
      });
    }

    this._animationTimer = this.clock.setTimeout(() => {
      this._animationTimer = undefined;
      this.advanceTurn();
    }, env.ANIMATION_TIMEOUT_MS);
  }

  private advanceTurn(): void {
    if (this._animationTimer) {
      this._animationTimer.clear();
      this._animationTimer = undefined;
    }
    if (this.state.phase === 'ended') return;

    const cur = this.state.turn_player_id;
    const nextId = this._slotOrder.find((id) => id !== cur) ?? cur;
    this.state.round += 1;
    this.state.phase = 'active';
    this.broadcast('turn_switched', {
      new_turn_id: nextId,
      deadline_at: Date.now() + env.TURN_DEADLINE_MS,
      round: this.state.round,
    });
    this.startTurn(nextId);
  }

  private endMatch(winnerId: string, outcome: string): void {
    this.clearAllTimers();
    this.state.winner_id = winnerId;
    this.state.outcome = outcome;
    this.state.phase = 'ended';

    const finalHp: Record<string, number> = {};
    for (const id of this._slotOrder) {
      const p = this.state.players.get(id);
      if (p) finalHp[id] = p.hp;
    }

    this.broadcast('match_ended', {
      winner: winnerId,
      outcome,
      final_hp: finalHp,
    });
    logger.info({ session_id: this.state.session_id, winner: winnerId, outcome }, 'phase: → ended');

    // D.6 will replace this with HTTP POST callback to bot.
    this._disposeTimer = this.clock.setTimeout(() => {
      this._disposeTimer = undefined;
      this.disconnect();
    }, env.RESULT_DISPOSE_DELAY_MS);
  }

  private clearAllTimers(): void {
    if (this._countdownTimer) {
      this._countdownTimer.clear();
      this._countdownTimer = undefined;
    }
    if (this._turnTimer) {
      this._turnTimer.clear();
      this._turnTimer = undefined;
    }
    if (this._animationTimer) {
      this._animationTimer.clear();
      this._animationTimer = undefined;
    }
    if (this._disposeTimer) {
      this._disposeTimer.clear();
      this._disposeTimer = undefined;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers (module-private)
// ─────────────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function cloneWeaponSchema(src: WeaponSchema): WeaponSchema {
  const ws = new WeaponSchema();
  ws.slug = src.slug;
  ws.display_name = src.display_name;
  ws.category = src.category;
  ws.tier = src.tier;

  const stats = new WeaponStatsSchema();
  stats.power = src.stats.power;
  stats.hitbox = src.stats.hitbox;
  stats.bounce = src.stats.bounce;
  stats.damage_base = src.stats.damage_base;
  stats.pierce_count = src.stats.pierce_count;
  stats.crit_chance = src.stats.crit_chance;
  stats.crit_multi = src.stats.crit_multi;
  ws.stats = stats;

  const visual = new WeaponVisualSchema();
  visual.model_prefab_key = src.visual.model_prefab_key;
  visual.particle_fx_key = src.visual.particle_fx_key;
  visual.trail_fx_key = src.visual.trail_fx_key;
  visual.hue = src.visual.hue;
  ws.visual = visual;

  ws.skills = new ArraySchema<WeaponSkillSchema>();
  for (let i = 0; i < src.skills.length; i++) {
    const s = src.skills[i];
    if (!s) continue;
    const sk = new WeaponSkillSchema();
    sk.skill_id = s.skill_id;
    sk.trigger = s.trigger;
    sk.magnitude = s.magnitude;
    sk.cooldown = s.cooldown;
    sk.fx_key = s.fx_key;
    ws.skills.push(sk);
  }
  return ws;
}
