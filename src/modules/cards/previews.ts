import type { Rendered } from '../pixel/output.js';
import { renderKitSheet } from './kit-sheet.js';

/** Every card with sample data, for scripts/render-preview.ts and tests. */
export const PREVIEWS: Record<string, () => Promise<Rendered>> = {
  'kit-sheet': renderKitSheet,
};
