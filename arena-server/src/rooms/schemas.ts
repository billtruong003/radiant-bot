import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';

/**
 * State schemas mirrored from docs/RADIANT_ARENA_COLYSEUS.md §3.
 *
 * All fields are default-initialized — Colyseus 2.0 serializes the default
 * on initial state and only emits diffs on mutation. Nested @type fields
 * must be `new ChildSchema()` not `null`, else the schema encoder throws
 * on first sync.
 *
 * Field naming uses snake_case to match the bot's entity convention and
 * the architecture spec's contract — Unity client schemas mirror this.
 */

export class WeaponStatsSchema extends Schema {
  @type('float32') power = 1.0;
  @type('float32') hitbox = 1.0;
  @type('float32') bounce = 0.5;
  @type('float32') damage_base = 20;
  @type('uint8') pierce_count = 0;
  @type('float32') crit_chance = 0;
  @type('float32') crit_multi = 1.5;
}

export class WeaponVisualSchema extends Schema {
  @type('string') model_prefab_key = '';
  @type('string') particle_fx_key = '';
  @type('string') trail_fx_key = '';
  @type('string') hue = '#ffffff';
}

export class WeaponSkillSchema extends Schema {
  @type('string') skill_id = '';
  /** 'passive' | 'onHit' | 'onCrit' | 'onLowHp' | 'signature' */
  @type('string') trigger = 'passive';
  @type('float32') magnitude = 0;
  @type('float32') cooldown = 0;
  @type('string') fx_key = '';
}

export class WeaponSchema extends Schema {
  @type('string') slug = '';
  @type('string') display_name = '';
  /** 'blunt' | 'pierce' | 'spirit' */
  @type('string') category = 'blunt';
  /** 'ban_menh' | 'pham' | 'dia' | 'thien' | 'tien' */
  @type('string') tier = 'pham';
  @type(WeaponStatsSchema) stats = new WeaponStatsSchema();
  @type(WeaponVisualSchema) visual = new WeaponVisualSchema();
  @type([WeaponSkillSchema]) skills = new ArraySchema<WeaponSkillSchema>();
}

export class TrajectoryPointSchema extends Schema {
  /** ms since shoot */
  @type('uint16') t = 0;
  @type('float32') x = 0;
  @type('float32') y = 0;
  /** '' | 'wall_bounce' | 'pierce_player' | 'hit:<dmg>' | 'crit:<dmg>' | 'stop' */
  @type('string') event = '';
}

export class PlayerSchema extends Schema {
  @type('string') discord_id = '';
  @type('string') display_name = '';
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('uint16') hp = 100;
  @type('uint16') hp_max = 100;
  /** Weapons the player can pick from in lobby — bot fills at room create. */
  @type([WeaponSchema]) available_weapons = new ArraySchema<WeaponSchema>();
  /** Server enforces ∈ available_weapons[].slug during lobby; locked at countdown. */
  @type('string') selected_weapon_slug = '';
  /** Cloned from available_weapons on countdown→active. */
  @type(WeaponSchema) weapon = new WeaponSchema();
  @type('boolean') ready = false;
  @type('boolean') connected = true;
  /** Epoch ms until which the signature skill is on cooldown. */
  @type('uint32') signature_cd_until = 0;
}

/**
 * 'waiting'   — room created, 0 players joined
 * 'lobby'     — 1-2 players present, picking weapons
 * 'countdown' — both ready, weapons locked, 3s pre-start
 * 'active'    — turn-based combat
 * 'animating' — shot resolved, waiting for client playback confirm
 * 'ended'     — terminal, result sent to bot, room disposing
 */
export class DuelState extends Schema {
  @type('string') session_id = '';
  @type('string') phase = 'waiting';
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type('string') turn_player_id = '';
  @type('uint32') turn_deadline_at = 0;
  @type('uint32') join_deadline_at = 0;
  @type('uint16') round = 0;
  @type('uint16') stake = 0;
  @type([TrajectoryPointSchema]) last_trajectory = new ArraySchema<TrajectoryPointSchema>();
  @type('string') last_shooter_id = '';
  @type('string') winner_id = '';
  /** '' | 'win' | 'timeout_join' | 'double_afk' | 'disconnect' | 'concede' */
  @type('string') outcome = '';
  @type('uint16') map_width = 1000;
  @type('uint16') map_height = 1000;
}
