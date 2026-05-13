import { createCanvas } from 'canvas';

/**
 * Image captcha for suspect members (account < 7 days, no avatar, or
 * raid mode active). 6-char string from a confusion-resistant alphabet
 * (no O/0/I/1/L) rendered with mild rotation + speckle noise + cross-out
 * lines. Designed to be trivial for a human eye and non-trivial for
 * commodity OCR without dedicated training.
 *
 * Caller verifies the reply by comparing case-insensitively against
 * `text`. Pair this with `captcha-math` for the "hard" variant where
 * the user must enter both `<imageText> <mathAnswer>`.
 */

export interface ImageChallenge {
  text: string;
  buffer: Buffer;
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // skip 0/O, 1/I/L
const WIDTH = 200;
const HEIGHT = 70;
const TEXT_LENGTH = 6;
const NOISE_DOTS = 100;
const NOISE_LINES = 4;

function pickChar(): string {
  return ALPHABET[Math.floor(Math.random() * ALPHABET.length)] ?? 'A';
}

export function generateImageCaptcha(): ImageChallenge {
  const text = Array.from({ length: TEXT_LENGTH }, pickChar).join('');

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Dark background.
  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Speckle noise.
  for (let i = 0; i < NOISE_DOTS; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * WIDTH, Math.random() * HEIGHT, 1, 1);
  }

  // The characters — each lightly rotated.
  ctx.font = 'bold 36px sans-serif';
  ctx.fillStyle = '#fafafa';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    ctx.save();
    ctx.translate(20 + i * 28, HEIGHT / 2);
    ctx.rotate((Math.random() - 0.5) * 0.4);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }

  // Cross-out lines.
  for (let i = 0; i < NOISE_LINES; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.2})`;
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    ctx.moveTo(Math.random() * WIDTH, Math.random() * HEIGHT);
    ctx.lineTo(Math.random() * WIDTH, Math.random() * HEIGHT);
    ctx.stroke();
  }

  return { text, buffer: canvas.toBuffer('image/png') };
}

/**
 * Lenient compare for image captcha. Strips whitespace, case-insensitive
 * because the alphabet is uppercase but users may type lowercase.
 */
export function verifyImageReply(reply: string, expected: string): boolean {
  const cleaned = reply.trim().toUpperCase();
  if (!cleaned) return false;
  return cleaned === expected.toUpperCase();
}

/**
 * Splits a "hard" reply that combines image + math into two parts.
 * Format expected: `<image-text> <math-answer>` (space-separated).
 * Returns `null` if the format doesn't have two tokens.
 */
export function parseHardReply(reply: string): { imageText: string; mathAnswer: string } | null {
  const parts = reply.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [imageText, mathAnswer] = parts;
  if (!imageText || !mathAnswer) return null;
  return { imageText, mathAnswer };
}
