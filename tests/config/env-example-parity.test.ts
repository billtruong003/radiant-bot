import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards against `.env.example` drifting behind `envSchema`.
 *
 * This drifted badly once already: by Phase 15 the example was missing 13
 * of 26 variables — everything added from Phase 10 onward — so a fresh
 * clone silently came up with no AI providers and no arena, with nothing
 * to indicate why. Config that only exists in code is config nobody sets.
 */

const ROOT = join(__dirname, '..', '..');

function schemaKeys(): string[] {
  const src = readFileSync(join(ROOT, 'src', 'config', 'env.ts'), 'utf-8');
  // Two-space indented `KEY: z...` entries inside the z.object literal.
  return [...src.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1] as string);
}

function exampleKeys(): string[] {
  const src = readFileSync(join(ROOT, '.env.example'), 'utf-8');
  return [...src.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1] as string);
}

describe('.env.example parity with envSchema', () => {
  it('documents every variable the schema declares', () => {
    const missing = schemaKeys().filter((k) => !exampleKeys().includes(k));
    expect(missing, `thiếu trong .env.example: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not document variables the schema no longer has', () => {
    const stale = exampleKeys().filter((k) => !schemaKeys().includes(k));
    expect(stale, `thừa trong .env.example (schema đã bỏ): ${stale.join(', ')}`).toEqual([]);
  });
});
