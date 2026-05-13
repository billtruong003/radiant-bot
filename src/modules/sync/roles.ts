import type { Guild, Role } from 'discord.js';
import { ROLES, type RoleDef } from '../../config/server-structure.js';
import { logger } from '../../utils/logger.js';
import { type SyncCounters, type SyncOptions, rateDelay } from './common.js';

export type RoleMap = Map<string, Role>;

function hexToInt(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

function rolePropsMatch(role: Role, def: RoleDef): boolean {
  return (
    role.colors.primaryColor === hexToInt(def.colorHex) &&
    role.hoist === def.hoist &&
    role.mentionable === def.mentionable
  );
}

/**
 * Idempotent role sync. For each `RoleDef` in `ROLES`:
 *   - if a role with that name exists → diff props, edit if any drift
 *   - if not → create
 * Never deletes roles. Returns a name→Role map for downstream channel sync.
 */
export async function syncRoles(
  guild: Guild,
  opts: SyncOptions,
  counters: SyncCounters,
): Promise<RoleMap> {
  await guild.roles.fetch();
  const byName = new Map<string, Role>();
  for (const r of guild.roles.cache.values()) {
    byName.set(r.name, r);
  }

  const result: RoleMap = new Map();

  for (const def of ROLES) {
    const existing = byName.get(def.name);
    if (existing) {
      if (rolePropsMatch(existing, def)) {
        logger.debug({ role: def.name }, 'sync: role up-to-date');
        counters.rolesUnchanged++;
      } else {
        logger.info(
          {
            role: def.name,
            color: {
              from: existing.colors.primaryColor.toString(16),
              to: def.colorHex,
            },
            hoist: { from: existing.hoist, to: def.hoist },
            mentionable: { from: existing.mentionable, to: def.mentionable },
          },
          'sync: role drift — will edit',
        );
        counters.rolesUpdated++;
        if (!opts.dryRun) {
          await existing.edit({
            colors: { primaryColor: hexToInt(def.colorHex) },
            hoist: def.hoist,
            mentionable: def.mentionable,
            reason: 'sync-server: align role props with server-structure.ts',
          });
          await rateDelay(opts);
        }
      }
      result.set(def.name, existing);
      continue;
    }

    // Create.
    logger.info({ role: def.name, color: def.colorHex }, 'sync: creating role');
    counters.rolesCreated++;
    if (opts.dryRun) {
      // In dry-run, we can't insert a fake Role into the map; leave it
      // missing so the downstream perm resolver will silently skip overwrites
      // referencing it. Phase 2 first apply will create the role; second
      // dry-run will see it exist.
      continue;
    }
    const created = await guild.roles.create({
      name: def.name,
      colors: { primaryColor: hexToInt(def.colorHex) },
      hoist: def.hoist,
      mentionable: def.mentionable,
      reason: 'sync-server: create role per server-structure.ts',
    });
    result.set(def.name, created);
    await rateDelay(opts);
  }

  // @everyone is always there as guild.id role; expose it via the map for
  // perm-presets which references it by ID, not name. The convention here is
  // that callers use `guild.roles.everyone.id`, not the map lookup.

  return result;
}
