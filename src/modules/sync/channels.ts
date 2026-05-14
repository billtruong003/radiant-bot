import {
  type CategoryChannel,
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  type GuildChannel,
  type OverwriteData,
  PermissionsBitField,
} from 'discord.js';
import { canonicalChannelName } from '../../config/channels.js';
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

/**
 * Searches the whole guild for a channel by name + type. Used regardless of
 * dry-run vs apply so the projection is consistent: if a channel exists
 * under the wrong parent (e.g. Discord starter channels at root), syncChannel
 * will move it into the correct category and count it as an update.
 *
 * Phase 11 A5: also matches by canonical (slug) form so a channel currently
 * named `general` matches the schema's `💬-general-💬`. syncChannel then
 * detects the display-name drift and renames the existing channel.
 */
function findChannelByName(
  guild: Guild,
  name: string,
  type: ChannelType,
): GuildBasedChannel | undefined {
  const targetCanonical = canonicalChannelName(name);
  let canonicalMatch: GuildBasedChannel | undefined;
  for (const ch of guild.channels.cache.values()) {
    if (ch.type !== type) continue;
    if (ch.name === name) return ch; // exact match wins
    if (canonicalChannelName(ch.name) === targetCanonical) canonicalMatch = ch;
  }
  return canonicalMatch;
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
      await syncChannel(guild, category, catDef.name, chDef, target, opts, counters);
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
  targetCategoryName: string,
  def: ChannelDef,
  targetOverwrites: OverwriteData[],
  opts: SyncOptions,
  counters: SyncCounters,
): Promise<void> {
  const expectedType = CHANNEL_TYPE_TO_DISCORD[def.type];
  const existing = findChannelByName(guild, def.name, expectedType);

  if (existing && 'permissionOverwrites' in existing) {
    // Compare parents by NAME, not ID. In dry-run the target category may not
    // exist yet (no ID), but its name is stable; on apply the category exists.
    // Same comparison covers both paths.
    const currentParentName = existing.parent?.name ?? null;
    const parentDrift = currentParentName !== targetCategoryName;
    const permsDrift = !overwritesEqual(existing, targetOverwrites);
    // Display-name drift: canonical matches but exact name differs. This
    // is the migration trigger for Phase 11 A5 (channels were renamed
    // to include decorative icons). One-shot per channel.
    const nameDrift = existing.name !== def.name;

    if (!parentDrift && !permsDrift && !nameDrift) {
      logger.debug({ channel: def.name }, 'sync: channel up-to-date');
      counters.channelsUnchanged++;
      return;
    }

    logger.info(
      {
        channel: def.name,
        rename: nameDrift ? { from: existing.name, to: def.name } : 'unchanged',
        parent: parentDrift
          ? { from: currentParentName ?? '(root)', to: targetCategoryName }
          : 'unchanged',
        perms: permsDrift ? summarizeOverwrites(targetOverwrites) : 'unchanged',
      },
      'sync: channel drift — will update',
    );
    counters.channelsUpdated++;
    if (opts.dryRun) return;

    if (nameDrift) {
      await existing.setName(def.name, 'sync-server: rename to schema (icon decoration)');
      await rateDelay(opts);
    }
    if (parentDrift && category) {
      await existing.setParent(category.id, {
        lockPermissions: false,
        reason: 'sync-server: move into target category',
      });
      await rateDelay(opts);
    }
    if (permsDrift) {
      await existing.permissionOverwrites.set(
        targetOverwrites,
        'sync-server: align overwrites with server-structure.ts',
      );
      await rateDelay(opts);
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
