import { createHmac, timingSafeEqual } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { Client } from 'discord.js';
import { env } from '../config/env.js';
import { getStore } from '../db/index.js';
import { submitContribution } from '../modules/docs/validator.js';
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
    if (req.url === '/health') {
      const { status, body } = buildHealthPayload(client);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }
    if (req.url === '/api/contribute' && req.method === 'POST') {
      void handleContributeApi(req, res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
  });
  server.listen(port, () => {
    logger.info({ port }, 'health: listening on /health');
  });
  // Don't keep the event loop alive solely for the server.
  server.unref();
}

/**
 * Phase 12 Lát 9 — POST /api/contribute HMAC endpoint.
 *
 * Body: { author_id: string, title: string, body: string }
 * Header: X-Hub-Signature-256: sha256=<hex>
 * Secret: env.DOCS_HMAC_SECRET (empty = endpoint disabled with 503)
 *
 * Signature computed over the raw request body using HMAC-SHA256.
 * Mirrors GitHub webhook format so Bill's website can reuse existing
 * client libs.
 *
 * Same pipeline as /contribute-doc slash — just a different ingest seam.
 */
async function handleContributeApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const secret = env.DOCS_HMAC_SECRET;
  if (!secret) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'docs api disabled: DOCS_HMAC_SECRET not set' }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const c of req) {
      chunks.push(c as Buffer);
      // Cap body at 32KB to avoid DoS via giant payloads.
      if (Buffer.concat(chunks).length > 32 * 1024) {
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'body too large' }));
        return;
      }
    }
    const rawBody = Buffer.concat(chunks);

    const sigHeader = (req.headers['x-hub-signature-256'] as string | undefined) ?? '';
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    // timingSafeEqual requires equal-length buffers.
    if (
      sigHeader.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))
    ) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid signature' }));
      return;
    }

    const json = JSON.parse(rawBody.toString('utf-8')) as {
      author_id?: unknown;
      title?: unknown;
      body?: unknown;
    };
    if (
      typeof json.author_id !== 'string' ||
      typeof json.title !== 'string' ||
      typeof json.body !== 'string'
    ) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing or invalid fields' }));
      return;
    }

    const result = await submitContribution({
      authorId: json.author_id,
      title: json.title,
      body: json.body,
      source: 'api',
    });

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        contribution_id: result.contribution.id,
        decision: result.decision,
        score: result.contribution.score,
        difficulty: result.contribution.difficulty,
        section: result.contribution.section,
        tags: result.contribution.tags,
        rejection_reason: result.contribution.rejection_reason,
      }),
    );
  } catch (err) {
    logger.error({ err }, '/api/contribute: handler error');
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal' }));
  }
}

export function stopHealthServer(): void {
  if (!server) return;
  server.close();
  server = null;
  logger.info('health: stopped');
}
