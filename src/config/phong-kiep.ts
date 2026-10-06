import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Phong Kiếp question bank (phong-kiep-questions.json). Two kinds:
 * reading developer English (error messages, jargon) and predicting code
 * output in Python / C# / JavaScript. Every question links the
 * billthedev.com/docs lesson that teaches it.
 */

const questionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['english', 'output']),
    lang: z.enum(['python', 'csharp', 'javascript']).optional(),
    prompt: z.string().min(1),
    code: z.string().optional(),
    options: z.array(z.string().min(1)).length(4),
    answer: z.number().int().min(0).max(3),
    docs: z.string().startsWith('/docs/'),
    explain: z.string().min(1),
  })
  .refine((q) => new Set(q.options).size === 4, { message: 'options must be distinct' })
  .refine((q) => q.kind !== 'output' || (q.code && q.lang), {
    message: 'output needs code + lang',
  });

const bankSchema = z.object({ $schema: z.string(), questions: z.array(questionSchema).min(6) });

export type PhongKiepQuestion = z.infer<typeof questionSchema>;

export const DOCS_ORIGIN = 'https://www.billthedev.com';

let cached: PhongKiepQuestion[] | null = null;

export function loadPhongKiepQuestions(): PhongKiepQuestion[] {
  if (cached) return cached;
  const raw = readFileSync(
    fileURLToPath(new URL('./phong-kiep-questions.json', import.meta.url)),
    'utf-8',
  );
  const bank = bankSchema.parse(JSON.parse(raw));
  const ids = new Set(bank.questions.map((q) => q.id));
  if (ids.size !== bank.questions.length) throw new Error('phong-kiep: duplicate question id');
  cached = bank.questions;
  return cached;
}
