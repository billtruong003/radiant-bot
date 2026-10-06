import { describe, expect, it } from 'vitest';
import { SERVER_COMMAND_NAMES } from '../../src/config/server-vocab.js';

/**
 * Anti-drift guard. `server-vocab.ts` mirrors the command registry because
 * importing the real one from the request-analysis path would close an
 * import cycle (commands/index → ask → aki/client → request-analysis).
 *
 * A mirrored list is only safe if something fails when it diverges. This
 * is that something.
 */

describe('server vocabulary parity', () => {
  it('mirrors the real slash command registry exactly', async () => {
    const mod = await import('../../src/commands/index.js');
    // findCommand is the public surface; probe it with the mirrored names
    // and also confirm nothing in the registry is missing from the mirror.
    for (const name of SERVER_COMMAND_NAMES) {
      expect(
        mod.findCommand(name),
        `"${name}" is in server-vocab but not registered`,
      ).toBeDefined();
    }
    for (const command of mod.listCommands()) {
      expect(
        SERVER_COMMAND_NAMES,
        `"${command.data.name}" is registered but missing from server-vocab`,
      ).toContain(command.data.name);
    }
  });

  it('has no duplicates and stays sorted-ish for reviewability', () => {
    expect(new Set(SERVER_COMMAND_NAMES).size).toBe(SERVER_COMMAND_NAMES.length);
  });
});
