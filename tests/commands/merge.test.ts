import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { type SlashCommand, listCommands } from '../../src/commands/index.js';
import { mergeCommands } from '../../src/commands/merge.js';

type Opt = { type: number; name: string; description: string; options?: Opt[] };

describe('merged slash commands', () => {
  it('register 18 commands that satisfy Discord limits', () => {
    const all = listCommands().map((c) => c.data.toJSON() as unknown as Opt & { name: string });
    expect(all).toHaveLength(18);
    expect(new Set(all.map((c) => c.name)).size).toBe(18);
    const check = (o: Opt, depth: number) => {
      expect(o.name).toMatch(/^[\p{Ll}\p{Lo}\p{N}_-]{1,32}$/u);
      expect(o.description.length).toBeGreaterThan(0);
      expect(o.description.length).toBeLessThanOrEqual(100);
      expect((o.options ?? []).length).toBeLessThanOrEqual(25);
      if (o.type === 2) expect(depth).toBe(1);
      for (const child of o.options ?? []) check(child, depth + 1);
    };
    for (const c of all) check(c, 0);
  });

  it('routes a subcommand to its child and a group to its child', async () => {
    const calls: string[] = [];
    const leaf = {
      data: { name: 'leaf', toJSON: () => ({ name: 'leaf', description: 'd', options: [] }) },
      execute: async () => void calls.push('leaf'),
    };
    const tree = {
      data: {
        name: 'tree',
        toJSON: () => ({
          name: 'tree',
          description: 'd',
          options: [{ type: 1, name: 'list', description: 'l' }],
        }),
      },
      execute: async () => void calls.push('tree'),
    };
    const merged = mergeCommands('parent', 'p', [
      { as: 'a', command: leaf as unknown as SlashCommand },
      { as: 'b', command: tree as unknown as SlashCommand },
    ]);
    const json = merged.data.toJSON() as unknown as Opt;
    expect(json.options?.map((o) => [o.name, o.type])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    const fake = (group: string | null, sub: string) =>
      ({
        options: { getSubcommandGroup: () => group, getSubcommand: () => sub },
      }) as unknown as ChatInputCommandInteraction;
    await merged.execute(fake(null, 'a'));
    await merged.execute(fake('b', 'list'));
    expect(calls).toEqual(['leaf', 'tree']);
  });
});
