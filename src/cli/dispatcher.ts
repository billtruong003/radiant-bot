import { connectBot } from './connect.js';
import { type BotCliService, offlineContext } from './service.js';
import { bulkOnboard } from './services/bulk-onboard.js';
import { listChannels } from './services/list-channels.js';
import { notify } from './services/notify.js';
import { permissions } from './services/permissions.js';
import { pinChannelGuides } from './services/pin-channel-guides.js';
import { send } from './services/send.js';
import { setupReactionRoles } from './services/setup-reaction-roles.js';
import { simulateAutomod } from './services/simulate-automod.js';
import { simulateTribulation } from './services/simulate-tribulation.js';
import { simulateVerify } from './services/simulate-verify.js';
import { simulateWeeklyLeaderboard } from './services/simulate-weekly-leaderboard.js';
import { simulateWelcome } from './services/simulate-welcome.js';
import { uploadRoleIcons } from './services/upload-role-icons.js';
import { whoami } from './services/whoami.js';

const SERVICES: readonly BotCliService[] = [
  whoami,
  permissions,
  listChannels,
  send,
  notify,
  bulkOnboard,
  simulateVerify,
  simulateAutomod,
  setupReactionRoles,
  simulateWelcome,
  simulateWeeklyLeaderboard,
  simulateTribulation,
  pinChannelGuides,
  uploadRoleIcons,
];

function printHelp(): void {
  const lines: string[] = [
    '',
    'Bot operator CLI — strategy-pattern dispatcher.',
    '',
    'Usage:',
    '  npm run bot -- <service> [args...]',
    '',
    'Available services:',
  ];
  const nameWidth = Math.max(...SERVICES.map((s) => s.name.length));
  for (const svc of SERVICES) {
    lines.push(`  ${svc.name.padEnd(nameWidth)}   ${svc.description}`);
  }
  lines.push('');
  lines.push('Per-service usage (run with bad args to see usage string):');
  for (const svc of SERVICES) {
    lines.push(`  ${svc.usage}`);
  }
  lines.push('');
  process.stdout.write(lines.join('\n'));
}

export async function dispatch(argv: readonly string[]): Promise<void> {
  const [subcommand, ...rest] = argv;

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }

  const service = SERVICES.find((s) => s.name === subcommand);
  if (!service) {
    process.stderr.write(`\n[bot-cli] unknown service: "${subcommand}"\n`);
    printHelp();
    process.exit(1);
  }

  if (!service.needsClient) {
    await service.execute(offlineContext(), rest);
    return;
  }

  const { client, guild } = await connectBot();
  try {
    await service.execute({ client, guild }, rest);
  } finally {
    await client.destroy();
  }
}
