import type { BotCliService } from '../service.js';

export const whoami: BotCliService = {
  name: 'whoami',
  description: 'Print bot identity + target guild summary',
  usage: 'whoami',
  needsClient: true,
  async execute(ctx) {
    const c = ctx.client;
    const g = ctx.guild;
    if (!c || !g) throw new Error('whoami requires a connected client');
    const me = await g.members.fetchMe();
    const out = [
      '',
      '=== Bot identity ===',
      `Tag         : ${c.user?.tag}`,
      `Bot ID      : ${c.user?.id}`,
      '',
      '=== Guild ===',
      `Name        : ${g.name}`,
      `ID          : ${g.id}`,
      `Member count: ${g.memberCount}`,
      '',
      '=== Bot in guild ===',
      `Nickname    : ${me.nickname ?? '(default)'}`,
      `Role count  : ${me.roles.cache.size}`,
      `Roles       : ${[...me.roles.cache.values()]
        .filter((r) => r.id !== g.id) // skip @everyone
        .map((r) => r.name)
        .join(', ')}`,
      `Administrator: ${me.permissions.has('Administrator')}`,
      '',
    ].join('\n');
    process.stdout.write(out);
  },
};
