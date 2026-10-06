import type { Rendered } from '../pixel/output.js';
import { renderAvatarCard } from './avatar-card.js';
import { renderKitSheet } from './kit-sheet.js';
import { renderProfileCard } from './profile-card.js';
import { LOOK_BILL, sampleProfile } from './samples.js';

/** Every card with sample data, for scripts/render-preview.ts and tests. */
export const PREVIEWS: Record<string, () => Promise<Rendered>> = {
  'kit-sheet': renderKitSheet,
  avatar: () => renderAvatarCard({ look: LOOK_BILL, name: 'Bill The Dev', rank: 'kim_dan' }),
  'avatar-empty': () => renderAvatarCard({ look: null, name: 'Tán Tu 042', rank: 'kim_dan' }),
  profile: () => renderProfileCard(sampleProfile()),
};
