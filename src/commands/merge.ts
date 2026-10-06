import {
  type APIApplicationCommandOption,
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { SlashCommand } from './index.js';

/**
 * Folds several slash commands into one parent, so related commands share a
 * name: `/weapon list` becomes `/gear weapon list`, `/me` becomes `/profile me`.
 * Each child keeps its own code untouched:
 *   - a child with subcommands becomes a subcommand GROUP of the parent, and
 *     its `getSubcommand()` still returns its own subcommand;
 *   - a child without subcommands becomes a SUBCOMMAND, and its option
 *     getters read the same options as before.
 * Children must not have subcommand groups themselves (Discord allows only
 * one level of grouping).
 */

export interface MergedChild {
  /** Name under the parent, e.g. `weapon` in `/gear weapon`. */
  as: string;
  command: SlashCommand;
}

const isSub = (o: APIApplicationCommandOption) =>
  o.type === ApplicationCommandOptionType.Subcommand ||
  o.type === ApplicationCommandOptionType.SubcommandGroup;

export function mergeCommands(
  name: string,
  description: string,
  children: MergedChild[],
  defaultMemberPermissions: string | null = null,
): SlashCommand {
  const byName = new Map(children.map((c) => [c.as, c.command]));
  const options = children.map(({ as, command }) => {
    const json = command.data.toJSON() as RESTPostAPIChatInputApplicationCommandsJSONBody;
    const own = json.options ?? [];
    if (own.some((o) => o.type === ApplicationCommandOptionType.SubcommandGroup)) {
      throw new Error(`/${json.name} has subcommand groups and cannot be merged into /${name}`);
    }
    return own.some(isSub)
      ? {
          type: ApplicationCommandOptionType.SubcommandGroup,
          name: as,
          description: json.description,
          options: own,
        }
      : {
          type: ApplicationCommandOptionType.Subcommand,
          name: as,
          description: json.description,
          options: own,
        };
  });
  const body = {
    name,
    description,
    dm_permission: false,
    default_member_permissions: defaultMemberPermissions,
    options,
  } as RESTPostAPIChatInputApplicationCommandsJSONBody;

  const childFor = (interaction: ChatInputCommandInteraction | AutocompleteInteraction) =>
    byName.get(
      interaction.options.getSubcommandGroup(false) ??
        interaction.options.getSubcommand(false) ??
        '',
    );

  return {
    data: { name, toJSON: () => body } as unknown as SlashCommand['data'],
    async execute(interaction) {
      await childFor(interaction)?.execute(interaction);
    },
    async autocomplete(interaction) {
      const child = childFor(interaction);
      if (child?.autocomplete) await child.autocomplete(interaction);
      else await interaction.respond([]);
    },
  };
}
