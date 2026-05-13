import {
  type CategoryChannel,
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  type GuildChannel,
  type OverwriteData,
  PermissionsBitField,
} from 'discord.js';
import {
  CATEGORIES,
  CHANNEL_TYPE_TO_DISCORD,
  type CategoryDef,
  type ChannelDef,
} from '../../config/server-structure.js';
import { logger } from '../../utils/logger.js';
import { type SyncCounters, type SyncOptions, rateDelay } from './common.js';
import { resolveOverwrites } from './perm-presets.js';
import type { RoleMap } from './roles.js';

function findCategory(guild: Guild, name: string): CategoryChannel | undefined {
  for (const ch of guild.channels.cache.values()) {
    if (ch.type === ChannelType.GuildCategory && ch.name === name) {
      return ch;
    }
  }
  return undefined;
}

function findChannelInCategory(
  category: CategoryChannel,
  name: string,
  type: ChannelType,
): GuildBasedChannel | undefined {
  for (const ch of category.children.cache.values()) {
    if (ch.name === name && ch.type === type) return ch;
  }
  return undefined;
}

/**
 * Compares the channel's current overwrites with the target list. Returns
 * true if they're already equivalent (same set of IDs with same allow/deny
 * bitfields). Allows perm sync to skip the API call in the steady state.
 */
function resolveBits(v: OverwriteData['allow']): bigint {
  if (v === undefined || v === null) return 0n;
  return PermissionsBitField.resolve(v);
}

function overwritesEqual(channel: GuildChannel, target: OverwriteData[]): boolean {
  const current = channel.permissionOverwrites.cache;
  if (current.size !== target.length) return false;
  for (const t of target) {
    const c = current.get(String(t.id));
    if (!c) return false;
    if (c.allow.bitfield !== resolveBits(t.allow) || c.deny.bitfield !== resolveBits(t.deny)) {
      return false;
    }
  }
  return true;
}

function summarizeOverwrites(target: OverwriteData[]): string {
  return target
    .map((o) => {
      const allowFlags = new PermissionsBitField(resolveBits(o.allow))
        .toArray()
        .slice(0, 3)
        .join(',');
      const denyFlags = new PermissionsBitField(resolveBits(o.deny))
        .toArray()
        .slice(0, 3)
        .join(',');
      return `${o.id}{+${allowFlags || '-'}/-${denyFlags || '-'}}`;
    })
    .join(' ');
}

export async function syncCategoriesAndChannels(
  guild: Guild,
  roleMap: RoleMap,
  opts: SyncOptions,
  counters: SyncCounters,
): Promise<void> {
  await guild.channels.fetch();
  const everyoneRoleId = guild.roles.everyone.id;
  const ctx = { everyoneRoleId, roleByName: roleMap };

  for (const catDef of CATEGORIES) {
    const category = await syncCategory(guild, catDef, opts, counters);
    if (!category && !opts.dryRun) {
      logger.error({ category: catDef.name }, 'sync: category missing after create — abort branch');
      continue;
    }

    for (const chDef of catDef.channels) {
      const target = resolveOverwrites(chDef.perm, ctx);
      await syncChannel(guild, category, chDef, target, opts, counters);
    }
  }
}

async function syncCategory(
  guild: Guild,
  def: CategoryDef,
  opts: SyncOptions,
  counters: SyncCounters,
): Promise<CategoryChannel | null> {
  const existing = findCategory(guild, def.name);
  if (existing) {
    logger.debug({ category: def.name }, 'sync: category exists');
    counters.categoriesUnchanged++;
    return existing;
  }
  logger.info({ category: def.name }, 'sync: creating category');
  counters.categoriesCreated++;
  if (opts.dryRun) return null;

  const created = await guild.channels.create({
    name: def.name,
    type: ChannelType.GuildCategory,
    reason: 'sync-server: create category per server-structure.ts',
  });
  await rateDelay(opts);
  return created;
}

async function syncChannel(
  guild: Guild,
  category: CategoryChannel | null,
  def: ChannelDef,
  targetOverwrites: OverwriteData[],
  opts: SyncOptions,
  counters: SyncCounters,
): Promise<void> {
  const expectedType = CHANNEL_TYPE_TO_DISCORD[def.type];

  // Look up channel under this category, or anywhere if category is null
  // (dry-run pre-create state).
  let existing: GuildBasedChannel | undefined;
  if (category) {
    existing = findChannelInCategory(category, def.name, expectedType);
  } else {
    for (const ch of guild.channels.cache.values()) {
      if (ch.name === def.name && ch.type === expectedType) {
        existing = ch;
        break;
      }
    }
  }

  if (existing && 'permissionOverwrites' in existing) {
    if (overwritesEqual(existing, targetOverwrites)) {
      logger.debug({ channel: def.name }, 'sync: channel perms up-to-date');
      counters.channelsUnchanged++;
    } else {
      logger.info(
        { channel: def.name, target: summarizeOverwrites(targetOverwrites) },
        'sync: channel perm drift — will set overwrites',
      );
      counters.channelsUpdated++;
      if (!opts.dryRun) {
        await existing.permissionOverwrites.set(
          targetOverwrites,
          'sync-server: align overwrites with server-structure.ts',
        );
        await rateDelay(opts);
      }
    }
    return;
  }

  logger.info({ channel: def.name, type: def.type, perm: def.perm }, 'sync: creating channel');
  counters.channelsCreated++;
  if (opts.dryRun) return;

  await guild.channels.create({
    name: def.name,
    type: expectedType,
    parent: category?.id,
    permissionOverwrites: targetOverwrites,
    reason: 'sync-server: create channel per server-structure.ts',
  });
  await rateDelay(opts);
}
