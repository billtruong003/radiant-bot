import type { IncomingMessage, ServerResponse } from 'node:http';
import { rankById } from '../../config/cultivation.js';
import { env } from '../../config/env.js';
import { getStore } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { readJsonBody, sendHtml, sendJson } from '../web/router.js';
import { messagePage, page } from '../web/shell.js';
import {
  AVATAR_LAYERS,
  DEFAULT_LOOK,
  LAYER_KEYS,
  describeLook,
  isUnlocked,
  validateLook,
} from './catalog.js';
import { notifyAvatarSaved } from './hooks.js';
import { readAvatarLink, takeSaveSlot } from './link.js';
import { getLook, rankOf, saveLook } from './service.js';

/** Secret that signs every player web link; falls back to the hunter OAuth secret. */
export const webSecret = (): string => env.WEB_LINK_SECRET || env.HUNTER_STATE_SECRET;

const EXPIRED = messagePage(
  'Link này hết hạn rồi',
  'Link chỉ dùng được 15 phút, và mất hiệu lực khi bạn lấy link mới. Quay lại Discord gõ <b>/profile avatar</b> nhé.',
);

export async function handleAvatarWeb(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const p = url.pathname;
  if (req.method === 'GET' && (p === '/avatar' || p === '/avatar/')) {
    const link = readAvatarLink(url.searchParams.get('t') ?? '', webSecret());
    if (!link) return sendHtml(res, 410, EXPIRED);
    sendHtml(
      res,
      200,
      page({
        title: 'Tạo hình tu sĩ',
        body: '<div id="app" class="wrap"></div>',
        script: 'avatar',
      }),
    );
    return;
  }
  if (req.method === 'GET' && p === '/avatar/api/state') {
    const link = readAvatarLink(url.searchParams.get('t') ?? '', webSecret());
    if (!link) return sendJson(res, 410, { ok: false, error: 'expired' });
    const rank = rankOf(link.discordId);
    const user = getStore().users.get(link.discordId);
    sendJson(res, 200, {
      ok: true,
      name: user?.display_name ?? user?.username ?? 'Tu sĩ',
      rankName: rankById(rank).name,
      expiresAt: link.expiresAt,
      look: getLook(link.discordId) ?? DEFAULT_LOOK,
      hasLook: getLook(link.discordId) !== null,
      layers: LAYER_KEYS.map((key) => ({
        key,
        label: AVATAR_LAYERS[key].label,
        options: AVATAR_LAYERS[key].options.map((o) => ({
          label: o.label,
          swatch: o.swatch,
          locked: !isUnlocked(o, rank),
          need: o.minRank ? rankById(o.minRank).name : null,
        })),
      })),
    });
    return;
  }
  if (req.method === 'POST' && p === '/avatar/api/save') {
    let body: { t?: unknown; look?: unknown };
    try {
      body = ((await readJsonBody(req)) ?? {}) as { t?: unknown; look?: unknown };
    } catch {
      return sendJson(res, 400, { ok: false, error: 'Dữ liệu gửi lên không đọc được.' });
    }
    const link = readAvatarLink(typeof body.t === 'string' ? body.t : '', webSecret());
    if (!link)
      return sendJson(res, 410, {
        ok: false,
        error: 'Link đã hết hạn. Gõ /profile avatar để lấy link mới.',
      });
    if (!takeSaveSlot(link.discordId))
      return sendJson(res, 429, { ok: false, error: 'Lưu nhanh quá, đợi một phút rồi lưu tiếp.' });
    const v = validateLook(body.look, rankOf(link.discordId));
    if (!v.ok) return sendJson(res, 400, { ok: false, error: v.error });
    await saveLook(link.discordId, v.look);
    logger.info({ discord_id: link.discordId }, 'avatar: saved from web');
    void notifyAvatarSaved(link.discordId, v.look, link.reply, link.expiresAt);
    sendJson(res, 200, { ok: true, summary: describeLook(v.look) });
    return;
  }
  sendHtml(res, 404, messagePage('Không tìm thấy', 'Trang này không tồn tại.'));
}
