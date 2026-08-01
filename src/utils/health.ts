import { createHmac, timingSafeEqual } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { ChannelType, type Client, type Message, type TextChannel, type ThreadChannel } from 'discord.js';
import { canonicalChannelName } from '../config/channels.js';
import { env } from '../config/env.js';
import { getStore } from '../db/index.js';
import type { ArenaOutcome, ArenaSession } from '../db/types.js';
import { verifyBody } from '../modules/arena/tokens.js';
import { submitContribution } from '../modules/docs/validator.js';
import { runWeeklyAnalytics } from '../modules/insights/group-analytics.js';
import { runMemberProfiling } from '../modules/insights/member-profiles.js';
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
let botClient: Client | null = null;   // dùng cho /api/agent/* (Lucy điều khiển Aki)

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
  botClient = client;
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
    if (req.url === '/api/arena/result' && req.method === 'POST') {
      void handleArenaResultApi(req, res);
      return;
    }
    if (req.url === '/api/agent/profile-run' && req.method === 'POST') {
      void handleAgentProfileRun(req, res);
      return;
    }
    if (req.url === '/api/agent/post' && req.method === 'POST') {
      void handleAgentPost(req, res);
      return;
    }
    if (req.url === '/api/agent/channel' && req.method === 'POST') {
      void handleAgentChannel(req, res);
      return;
    }
    if (req.url === '/api/agent/message/get' && req.method === 'POST') {
      void handleAgentMessageGet(req, res);
      return;
    }
    if (req.url === '/api/agent/message/pin' && req.method === 'POST') {
      void handleAgentMessagePin(req, res);
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

/**
 * Phase 13 Lát A — POST /api/arena/result inbound from Colyseus.
 *
 * Body: {
 *   session_id, outcome, winner_id?, loser_id?, final_hp?, rounds_played?,
 *   trajectory_snapshot?, ended_at
 * }
 * Header: X-Arena-Signature: sha256=<hex over raw body>
 * Secret: env.ARENA_RESULT_SECRET (empty disables → 503)
 *
 * Effects:
 *   - Mark session row status='ended', persist outcome + winner + rounds.
 *   - Apply stake transfer (outcome='win' only): winner +stake pills,
 *     loser -stake pills (floor 0 — never negative).
 *   - Append xpLogs for both players (winner +50, loser +10 — participation).
 *   - Persist trajectory blob (capped 32KB) for later replay viewer.
 *   - Idempotent: re-running for an already-ended session returns 200 no-op.
 *
 * No Discord channel post in Lát A — that's handled by the arena flow
 * caller once Colyseus is live (Lát D).
 */
async function handleArenaResultApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const secret = env.ARENA_RESULT_SECRET;
  if (!secret) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'arena disabled: ARENA_RESULT_SECRET not set' }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const c of req) {
      chunks.push(c as Buffer);
      if (Buffer.concat(chunks).length > 64 * 1024) {
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'body too large' }));
        return;
      }
    }
    const rawBody = Buffer.concat(chunks);

    const sigHeader = (req.headers['x-arena-signature'] as string | undefined) ?? '';
    if (!verifyBody(rawBody, sigHeader, secret)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid signature' }));
      return;
    }

    const json = JSON.parse(rawBody.toString('utf-8')) as Record<string, unknown>;
    const sessionId = typeof json.session_id === 'string' ? json.session_id : null;
    const outcome = typeof json.outcome === 'string' ? (json.outcome as ArenaOutcome) : null;
    const endedAt = typeof json.ended_at === 'number' ? json.ended_at : Date.now();
    if (!sessionId || !outcome) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing session_id or outcome' }));
      return;
    }
    const validOutcomes: ArenaOutcome[] = ['win', 'timeout_join', 'double_afk', 'disconnect'];
    if (!validOutcomes.includes(outcome)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `invalid outcome: ${outcome}` }));
      return;
    }

    const store = getStore();
    const session = store.arenaSessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'session not found' }));
      return;
    }

    // Idempotent: if already ended, return current state.
    if (session.status === 'ended') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, idempotent: true, outcome: session.outcome }));
      return;
    }

    const winnerId =
      typeof json.winner_id === 'string'
        ? json.winner_id
        : outcome === 'win'
          ? null
          : null;
    const rounds = typeof json.rounds_played === 'number' ? json.rounds_played : null;
    const trajectory =
      typeof json.trajectory_snapshot === 'object' && json.trajectory_snapshot !== null
        ? JSON.stringify(json.trajectory_snapshot).slice(0, 32 * 1024)
        : null;

    // Apply stake transfer for definitive win outcomes only.
    if (outcome === 'win' && winnerId) {
      const loserId = winnerId === session.p1_id ? session.p2_id : session.p1_id;
      const winner = store.users.get(winnerId);
      const loser = store.users.get(loserId);
      const stake = session.stake;
      if (winner) {
        const newPills = (winner.pills ?? 0) + stake;
        await store.users.set({ ...winner, pills: newPills });
      }
      if (loser) {
        const newPills = Math.max(0, (loser.pills ?? 0) - stake);
        await store.users.set({ ...loser, pills: newPills });
      }
    }

    const updated: ArenaSession = {
      ...session,
      status: 'ended',
      outcome,
      winner_id: winnerId,
      ended_at: endedAt,
      rounds_played: rounds,
      trajectory_blob: trajectory,
    };
    await store.arenaSessions.set(updated);

    logger.info(
      {
        session_id: sessionId,
        outcome,
        winner_id: winnerId,
        rounds,
        stake: session.stake,
      },
      'arena: session ended via result callback',
    );

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        idempotent: false,
        outcome,
        winner_id: winnerId,
        rewards_processed: outcome === 'win',
      }),
    );
  } catch (err) {
    logger.error({ err }, '/api/arena/result: handler error');
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal' }));
  }
}

/**
 * Lucy agent control API — POST /api/agent/post + /api/agent/channel.
 * HMAC header: X-Lucy-Signature: sha256=<hex over raw body>, secret env.AGENT_HMAC_SECRET.
 * Cho Lucy (hub) ra lệnh Aki: đẩy báo cáo vào kênh / tạo kênh-thread. Empty secret = 503.
 */
async function readAgentBody(req: IncomingMessage, res: ServerResponse): Promise<Buffer | null> {
  const secret = env.AGENT_HMAC_SECRET;
  if (!secret) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'agent api disabled: AGENT_HMAC_SECRET not set' }));
    return null;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(c as Buffer);
    if (Buffer.concat(chunks).length > 32 * 1024) {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'body too large' }));
      return null;
    }
  }
  const rawBody = Buffer.concat(chunks);
  const sig = (req.headers['x-lucy-signature'] as string | undefined) ?? '';
  if (!verifyBody(rawBody, sig, secret)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid signature' }));
    return null;
  }
  return rawBody;
}

/** Tìm kênh/thread gửi được: theo ID (kể cả thread, fetch nếu chưa cache) trước, rồi theo tên text. */
async function resolveChannel(idOrName: string): Promise<TextChannel | ThreadChannel | null> {
  const guild = botClient?.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) return null;
  // Theo ID (text hoặc thread) — fetch từ API nếu chưa có trong cache.
  let byId = guild.channels.cache.get(idOrName) ?? null;
  if (!byId) {
    try { byId = await guild.channels.fetch(idOrName); } catch { byId = null; }
  }
  if (byId) {
    if (byId.type === ChannelType.GuildText) return byId as TextChannel;
    if (byId.isThread()) return byId as ThreadChannel;
  }
  // Theo tên (chỉ text channel, đã chuẩn hoá bỏ emoji).
  const q = canonicalChannelName(idOrName);
  for (const ch of guild.channels.cache.values()) {
    if (ch.type === ChannelType.GuildText && canonicalChannelName(ch.name) === q) return ch as TextChannel;
  }
  return null;
}

/**
 * POST /api/agent/profile-run — trigger a member-profiling pass on demand.
 *
 * Exists because profiling MUST run inside the bot process. Running it
 * from a separate script writes to the same WAL while the live bot holds
 * its own in-memory copy; the bot's next snapshot then overwrites the file
 * and truncates the WAL, silently destroying those rows. (Learned the hard
 * way on 2026-07-28 — 8 freshly-written profiles were lost exactly this
 * way.) Never add a second writer to this store.
 *
 * Returns immediately; the run continues in the background and reports
 * into #bot-log, because a full pass takes ~10s and can exceed a caller's
 * timeout.
 */
async function handleAgentProfileRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // MUST authenticate like every other /api/agent/* route. The health
  // server binds on all interfaces (HEALTH_PORT), so an unauthenticated
  // route here is remotely reachable — this endpoint triggers LLM work
  // and posts to Discord, so it is not a harmless read.
  const body = await readAgentBody(req, res);
  if (!body) return;

  if (!botClient) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bot chưa sẵn sàng' }));
    return;
  }
  if (!env.MEMBER_PROFILING_ENABLED) {
    res.writeHead(409, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'MEMBER_PROFILING_ENABLED=false' }));
    return;
  }
  // Optional { job: "analytics" } runs the weekly digest instead of the
  // daily profiling pass — same auth, same "fire and report to #bot-log"
  // contract, so it doesn't need a second route.
  let job = 'profiles';
  try {
    const parsed = JSON.parse(body.toString('utf-8') || '{}') as { job?: unknown };
    if (parsed.job === 'analytics') job = 'analytics';
  } catch {
    // Empty/invalid body → default job. Body carries no other meaning.
  }

  const client = botClient;
  const run = job === 'analytics' ? runWeeklyAnalytics(client) : runMemberProfiling(client);
  void run.catch((err) => {
    logger.error({ err, job }, '/api/agent/profile-run: run failed');
  });
  logger.info({ job }, '/api/agent/profile-run: Lucy kích hoạt job insights');
  res.writeHead(202, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, started: true, job }));
}

async function handleAgentPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readAgentBody(req, res);
    if (!body) return;
    const json = JSON.parse(body.toString('utf-8')) as {
      channel?: unknown;
      text?: unknown;
      mention_everyone?: unknown;
    };
    if (typeof json.channel !== 'string' || typeof json.text !== 'string' || !json.text.trim()) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'cần channel + text' }));
      return;
    }
    const ch = await resolveChannel(json.channel);
    if (!ch) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'không tìm thấy kênh' }));
      return;
    }
    // Mặc định allowedMentions parse:[] -> không ping nhầm. Chỉ bật @everyone/@here
    // khi Lucy gửi mention_everyone:true tường minh (announcement thật sự cần tag all).
    const allowedMentions = json.mention_everyone === true ? { parse: ['everyone' as const] } : { parse: [] };
    // Discord giới hạn 2000 ký tự; cắt an toàn.
    const sent = await ch.send({ content: json.text.slice(0, 1900), allowedMentions });
    logger.info({ channel: ch.id }, '/api/agent/post: Lucy đẩy báo cáo qua Aki');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channel_id: ch.id, message_id: sent.id }));
  } catch (err) {
    logger.error({ err }, '/api/agent/post: handler error');
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal' }));
  }
}

async function handleAgentChannel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readAgentBody(req, res);
    if (!body) return;
    const json = JSON.parse(body.toString('utf-8')) as { name?: unknown; type?: unknown; parent?: unknown; message?: unknown };
    if (typeof json.name !== 'string' || !json.name.trim()) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'cần name' }));
      return;
    }
    const guild = botClient?.guilds.cache.get(env.DISCORD_GUILD_ID);
    if (!guild) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'guild chưa sẵn sàng' }));
      return;
    }
    const name = json.name.slice(0, 90);
    if (json.type === 'thread') {
      const parentCh = typeof json.parent === 'string' ? await resolveChannel(json.parent) : null;
      const parent = parentCh && parentCh.type === ChannelType.GuildText ? (parentCh as TextChannel) : null;
      if (!parent) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'thread cần parent (kênh text hợp lệ)' }));
        return;
      }
      let threadId: string;
      if (typeof json.message === 'string' && json.message.trim()) {
        const starter = await parent.send({ content: json.message.slice(0, 1900), allowedMentions: { parse: [] } });
        const thread = await starter.startThread({ name, autoArchiveDuration: 10080 });
        threadId = thread.id;
      } else {
        const thread = await parent.threads.create({ name, autoArchiveDuration: 10080, type: ChannelType.PublicThread });
        threadId = thread.id;
      }
      logger.info({ parent: parent.id, thread: threadId }, '/api/agent/channel: Lucy tạo thread qua Aki');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, thread_id: threadId }));
      return;
    }
    const created = await guild.channels.create({ name, type: ChannelType.GuildText, reason: 'api/agent: Lucy tạo kênh' });
    logger.info({ channel: created.id }, '/api/agent/channel: Lucy tạo kênh qua Aki');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channel_id: created.id }));
  } catch (err) {
    logger.error({ err }, '/api/agent/channel: handler error');
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal' }));
  }
}

/** Lucy đọc 1 tin nhắn cụ thể (theo channel + message_id) — cho awareness về nội dung Discord. */
async function handleAgentMessageGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readAgentBody(req, res);
    if (!body) return;
    const json = JSON.parse(body.toString('utf-8')) as { channel?: unknown; message_id?: unknown };
    if (typeof json.channel !== 'string' || typeof json.message_id !== 'string' || !json.message_id.trim()) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'cần channel + message_id' }));
      return;
    }
    const ch = await resolveChannel(json.channel);
    if (!ch) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'không tìm thấy kênh' }));
      return;
    }
    let msg: Message;
    try {
      msg = await ch.messages.fetch(json.message_id as string);
    } catch {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'không tìm thấy tin nhắn (sai id hoặc đã xoá)' }));
      return;
    }
    logger.info({ channel: ch.id, message: msg.id }, '/api/agent/message/get: Lucy đọc tin nhắn qua Aki');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        channel_id: ch.id,
        message_id: msg.id,
        author: { id: msg.author.id, tag: msg.author.tag, bot: msg.author.bot },
        content: msg.content,
        created_at: msg.createdAt.toISOString(),
        pinned: msg.pinned,
        attachments: msg.attachments.map((a) => ({ name: a.name, url: a.url })),
      }),
    );
  } catch (err) {
    logger.error({ err }, '/api/agent/message/get: handler error');
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal' }));
  }
}

/** Lucy ghim 1 tin nhắn cụ thể (theo channel + message_id). */
async function handleAgentMessagePin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readAgentBody(req, res);
    if (!body) return;
    const json = JSON.parse(body.toString('utf-8')) as { channel?: unknown; message_id?: unknown };
    if (typeof json.channel !== 'string' || typeof json.message_id !== 'string' || !json.message_id.trim()) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'cần channel + message_id' }));
      return;
    }
    const ch = await resolveChannel(json.channel);
    if (!ch) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'không tìm thấy kênh' }));
      return;
    }
    let msg: Message;
    try {
      msg = await ch.messages.fetch(json.message_id as string);
    } catch {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'không tìm thấy tin nhắn (sai id hoặc đã xoá)' }));
      return;
    }
    await msg.pin();
    logger.info({ channel: ch.id, message: msg.id }, '/api/agent/message/pin: Lucy ghim tin nhắn qua Aki');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channel_id: ch.id, message_id: msg.id }));
  } catch (err) {
    logger.error({ err }, '/api/agent/message/pin: handler error');
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal' }));
  }
}

export function stopHealthServer(): void {
  if (!server) return;
  server.close();
  server = null;
  botClient = null;
  logger.info('health: stopped');
}
