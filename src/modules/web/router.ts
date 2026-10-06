import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { logger } from '../../utils/logger.js';
import { handleAvatarWeb } from '../avatar/web.js';
import { handleJudgeWeb } from '../judge/web.js';

/**
 * Routes for the player-facing web pages, served by the bot's HTTP server
 * (utils/health.ts) behind nginx. Returns false when the path is not ours.
 */

const ROOT = process.cwd();
const ASSET_ROOT = path.join(ROOT, 'assets', 'cultivation');
const CLIENT_ROOT = path.join(ROOT, 'web-client');

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(html);
}

export async function readJsonBody(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
}

/** PNG art under assets/cultivation, e.g. /cult/sprites/hair.png. */
async function serveAsset(res: ServerResponse, rel: string): Promise<void> {
  const full = path.normalize(path.join(ASSET_ROOT, rel));
  if (!full.startsWith(ASSET_ROOT + path.sep) || !full.endsWith('.png')) {
    res.writeHead(404).end();
    return;
  }
  try {
    const buf = await readFile(full);
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
    res.end(buf);
  } catch {
    res.writeHead(404).end();
  }
}

/** Browser code in web-client/<name>.ts, bundled on first request and kept. */
const bundles = new Map<string, Promise<string>>();
async function bundle(name: string): Promise<string> {
  const { build } = await import('esbuild');
  const out = await build({
    entryPoints: [path.join(CLIENT_ROOT, `${name}.ts`)],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    minify: true,
    logLevel: 'silent',
  });
  return out.outputFiles[0]?.text ?? '';
}
async function serveClient(res: ServerResponse, name: string): Promise<void> {
  if (!/^[a-z-]+$/.test(name)) {
    res.writeHead(404).end();
    return;
  }
  let p = bundles.get(name);
  if (!p) {
    p = bundle(name);
    bundles.set(name, p);
  }
  try {
    const js = await p;
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
    });
    res.end(js);
  } catch (err) {
    bundles.delete(name);
    logger.error({ err: (err as Error).message, name }, 'web: bundle failed');
    res.writeHead(500).end();
  }
}

export async function handleWeb(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  if (req.method === 'GET' && p.startsWith('/cult/')) {
    await serveAsset(res, decodeURIComponent(p.slice('/cult/'.length)));
    return true;
  }
  if (req.method === 'GET' && p.startsWith('/app/') && p.endsWith('.js')) {
    await serveClient(res, p.slice('/app/'.length, -3));
    return true;
  }
  if (p === '/avatar' || p.startsWith('/avatar/')) {
    await handleAvatarWeb(req, res, url);
    return true;
  }
  if (p === '/judge' || p.startsWith('/judge/')) {
    await handleJudgeWeb(req, res, url);
    return true;
  }
  return false;
}
