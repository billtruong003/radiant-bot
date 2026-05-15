import 'dotenv/config';
import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { env } from './env.js';
import { logger } from './logger.js';
import { DuelRoom } from './rooms/DuelRoom.js';

/**
 * Express health + admin endpoints + Colyseus WSS transport.
 * Rooms: 'duel' (DuelRoom) — spawned programmatically by /admin/create-room
 * after Lát D.3 lands; clients then JoinById with HMAC token.
 */

const app = express();
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptime_ms: Math.floor(process.uptime() * 1000),
    env: env.NODE_ENV,
  });
});

app.post('/admin/create-room', (_req, res) => {
  // TODO Lát D.3 — real HMAC handler + matchMaker.createRoom
  res.status(501).json({ error: 'not implemented yet (Lát D.3)' });
});

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('duel', DuelRoom);

httpServer.listen(env.ARENA_PORT, env.ARENA_HOST, () => {
  logger.info(
    { port: env.ARENA_PORT, host: env.ARENA_HOST, env: env.NODE_ENV },
    'arena server listening',
  );
});

function shutdown(sig: string): void {
  logger.info({ sig }, 'shutdown signal');
  gameServer
    .gracefullyShutdown()
    .catch((err) => logger.error({ err }, 'shutdown error'))
    .finally(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
