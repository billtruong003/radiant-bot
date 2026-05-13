import {
  type ButtonInteraction,
  type Client,
  Events,
  type Interaction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { loadVerificationConfig } from '../config/verification.js';
import {
  BUTTON_ID_OPEN_MODAL,
  BUTTON_ID_START,
  MODAL_ID,
  handleFallbackModalSubmit,
  handleFallbackOpenModalButton,
  handleFallbackStartButton,
} from '../modules/verification/flow.js';
import { logger } from '../utils/logger.js';

/**
 * `interactionCreate` event: dispatches verification fallback buttons +
 * modal submits to `flow.ts`. Slash commands are routed here too in
 * Chunk 6 once `/raid-mode` lands.
 */

async function dispatchButton(interaction: ButtonInteraction): Promise<void> {
  const config = await loadVerificationConfig();
  switch (interaction.customId) {
    case BUTTON_ID_START:
      await handleFallbackStartButton(interaction, config);
      return;
    case BUTTON_ID_OPEN_MODAL:
      await handleFallbackOpenModalButton(interaction);
      return;
    default:
      // Unknown button — ignore. Other modules will own their own IDs.
      return;
  }
}

async function dispatchModal(interaction: ModalSubmitInteraction): Promise<void> {
  const config = await loadVerificationConfig();
  if (interaction.customId === MODAL_ID) {
    await handleFallbackModalSubmit(interaction, config);
  }
}

async function handle(interaction: Interaction): Promise<void> {
  if (interaction.isButton()) {
    await dispatchButton(interaction);
    return;
  }
  if (interaction.isModalSubmit()) {
    await dispatchModal(interaction);
    return;
  }
  // Slash commands etc — wired up in Chunk 6 + Phase 4.
}

export function register(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    handle(interaction).catch((err) => {
      logger.error(
        {
          err,
          type: interaction.type,
          customId: 'customId' in interaction ? interaction.customId : null,
        },
        'interactionCreate: unhandled error',
      );
      // Best-effort user-facing message if the interaction is still alive.
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        interaction
          .reply({ content: '⚠️ Có lỗi xảy ra. Hãy thử lại.', ephemeral: true })
          .catch(() => undefined);
      }
    });
  });
}
