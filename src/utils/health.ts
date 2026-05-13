import { type Server, createServer } from 'node:http';
import type { Client } from 'discord.js';
import { getStore } from '../db/index.js';
import { logger } from './logger.js';

/**
 * Minimal HTTP health-check endpoint for UptimeRobot / cloud LB probes.
 * Single endpoint `/health` returns JSON with:
 *   - status     : 'ok' | 'degraded'
 *   - uptime_ms  : process.uptime() * 1000
 *   - discord    : { ready, ping_ms, guilds }
 *   - store      : { users, xp_logs, snapshot_path }
 *
 * Returns 503 if Discord client isn't ready, 200 otherwise.
 *
 * Listens on `HEALTH_PORT` (env). Disabled (no server) when port is 0.
 */

let server: Server | null = null;

function buildHealthPayload(client: Client | null): { status: number; body: string } {
  const ready = client?.isReady() ?? false;
  const store = (() => {
    try {
      return getStore();
    } catch {
      return null;
    }
  })();
  const payload = {
    status: ready ? 'ok' : 'degraded',
    uptime_ms: Math.floor(process.uptime() * 1000),
    discord: {
      ready,
      ping_ms: client?.ws.ping ?? -1,
      guilds: client?.guilds.cache.size ?? 0,
    },
    store: store
      ? {
          users: store.users.count(),
          xp_logs: store.xpLogs.count(),
          snapshot_path: store.getSnapshotPath(),
        }
      : null,
  };
  return {
    status: ready ? 200 : 503,
    body: JSON.stringify(payload),
  };
}

export function startHealthServer(port: number, client: Client): void {
  if (port <= 0) {
    logger.info('health: HEALTH_PORT=0, server disabled');
    return;
  }
  if (server) {
    logger.warn('health: already started, skipping');
    return;
  }
  server = createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found\n');
      return;
    }
    const { status, body } = buildHealthPayload(client);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  });
  server.listen(port, () => {
    logger.info({ port }, 'health: listening on /health');
  });
  // Don't keep the event loop alive solely for the server.
  server.unref();
}

export function stopHealthServer(): void {
  if (!server) return;
  server.close();
  server = null;
  logger.info('health: stopped');
}
