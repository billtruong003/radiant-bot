import { EmbedBuilder } from 'discord.js';
import {
  COLOR_AKI,
  COLOR_BLUE,
  COLOR_DARK,
  COLOR_GOLD,
  COLOR_GREEN,
  COLOR_ORANGE,
  COLOR_PURPLE,
  COLOR_RED,
  DIVIDER,
  FOOTER_BRAND,
} from '../config/ui.js';

/**
 * Embed factory with semantic types. Reduces boilerplate + enforces
 * consistent look across all `.send({ embeds: [...] })` call-sites.
 *
 * Usage:
 *   themedEmbed('success', { title: '...', description: '...' })
 *   themedEmbed('cultivation', { ... }).setThumbnail(url)
 *
 * Returns a `EmbedBuilder` so further fluent calls (setThumbnail,
 * addFields, setImage) still work.
 */

export type EmbedTheme =
  | 'success' // gold — victory, breakthrough, reward earned
  | 'info' // blue — general info, pass through
  | 'cultivation' // purple — events, tribulation, rare actions
  | 'danger' // red — kick, timeout, fail
  | 'warn' // orange — soft warning, retry
  | 'levelup' // green — small level-up
  | 'aki' // pink — Aki replies, neutral helper
  | 'admin' // dark — staff actions, audit
  | 'plain'; // neutral / no specific theme

const THEME_COLORS: Record<EmbedTheme, number> = {
  success: COLOR_GOLD,
  info: COLOR_BLUE,
  cultivation: COLOR_PURPLE,
  danger: COLOR_RED,
  warn: COLOR_ORANGE,
  levelup: COLOR_GREEN,
  aki: COLOR_AKI,
  admin: COLOR_DARK,
  plain: COLOR_BLUE,
};

export interface ThemedEmbedInput {
  title?: string;
  description?: string;
  /** Override the theme's default color (e.g. rank-specific hex). */
  color?: number;
  /** Add bot brand footer. Default true; set false to override. */
  brandFooter?: boolean;
  /** Custom footer text (replaces brand footer if provided). */
  footer?: string;
  /** Add server-side timestamp. Default true. */
  timestamp?: boolean;
}

export function themedEmbed(theme: EmbedTheme, opts: ThemedEmbedInput = {}): EmbedBuilder {
  const e = new EmbedBuilder().setColor(opts.color ?? THEME_COLORS[theme]);
  if (opts.title) e.setTitle(opts.title);
  if (opts.description) e.setDescription(opts.description);
  if (opts.footer) {
    e.setFooter({ text: opts.footer });
  } else if (opts.brandFooter !== false) {
    e.setFooter({ text: FOOTER_BRAND });
  }
  if (opts.timestamp !== false) e.setTimestamp();
  return e;
}

/**
 * Compose a description with consistent divider sections. Each section
 * is joined by a horizontal rule for visual hierarchy.
 */
export function sectioned(...sections: readonly string[]): string {
  return sections.filter(Boolean).join(`\n${DIVIDER}\n`);
}

/**
 * Helper for inline field that doesn't wrap. Use for short labels.
 */
export function inlineField(
  name: string,
  value: string,
): { name: string; value: string; inline: true } {
  return { name, value, inline: true };
}
