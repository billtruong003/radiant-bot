import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import type { JudgeLang } from './harness.js';

/**
 * Where a program actually runs. JDoodle first (free 200 runs a day, keys in
 * .env), a self-hosted Piston as fallback, and the local toolchain only in
 * development. Every provider returns the raw program output; judging
 * happens in judge.ts.
 */

export interface RunOutput {
  ok: boolean;
  output: string;
  /** CPU / wall time reported by the provider, when it reports one. */
  ms: number | null;
  provider: 'jdoodle' | 'piston' | 'local' | 'none';
  /** Why the run did not happen (ok = false). */
  error?: 'offline' | 'quota' | 'timeout' | 'failed';
}

const RUN_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------- daily budget

let budgetDay = '';
let budgetUsed = 0;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Runs left today on JDoodle (resets at 00:00 UTC, as JDoodle does). */
export function jdoodleLeft(): number {
  if (budgetDay !== today()) {
    budgetDay = today();
    budgetUsed = 0;
  }
  return Math.max(0, env.JDOODLE_DAILY_LIMIT - budgetUsed);
}

function spendJdoodle(): void {
  jdoodleLeft();
  budgetUsed += 1;
}

export function resetRunnerBudget(): void {
  budgetDay = '';
  budgetUsed = 0;
}

// ---------------------------------------------------------------- providers

const JDOODLE_LANG: Record<JudgeLang, { language: string; versionIndex: string }> = {
  python: { language: 'python3', versionIndex: '4' },
  javascript: { language: 'nodejs', versionIndex: '4' },
  csharp: { language: 'csharp', versionIndex: '4' },
};

async function postJson(url: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RUN_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}

async function runJdoodle(lang: JudgeLang, program: string): Promise<RunOutput> {
  if (!env.JDOODLE_CLIENT_ID || !env.JDOODLE_CLIENT_SECRET)
    return { ok: false, output: '', ms: null, provider: 'jdoodle', error: 'offline' };
  if (jdoodleLeft() <= 0)
    return { ok: false, output: '', ms: null, provider: 'jdoodle', error: 'quota' };
  spendJdoodle();
  try {
    const { status, data } = await postJson('https://api.jdoodle.com/v1/execute', {
      clientId: env.JDOODLE_CLIENT_ID,
      clientSecret: env.JDOODLE_CLIENT_SECRET,
      script: program,
      ...JDOODLE_LANG[lang],
    });
    const d = (data ?? {}) as { output?: unknown; cpuTime?: unknown; error?: unknown };
    if (status === 429)
      return { ok: false, output: '', ms: null, provider: 'jdoodle', error: 'quota' };
    if (status !== 200 || typeof d.output !== 'string') {
      logger.warn({ status, error: d.error }, 'judge: jdoodle run failed');
      return { ok: false, output: '', ms: null, provider: 'jdoodle', error: 'failed' };
    }
    const cpu = Number(d.cpuTime);
    return {
      ok: true,
      output: d.output,
      ms: Number.isFinite(cpu) ? Math.round(cpu * 1000) : null,
      provider: 'jdoodle',
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'judge: jdoodle unreachable');
    return { ok: false, output: '', ms: null, provider: 'jdoodle', error: 'timeout' };
  }
}

const PISTON_FILE: Record<JudgeLang, string> = {
  python: 'main.py',
  javascript: 'main.js',
  csharp: 'Main.cs',
};

async function runPiston(lang: JudgeLang, program: string): Promise<RunOutput> {
  if (!env.PISTON_URL)
    return { ok: false, output: '', ms: null, provider: 'piston', error: 'offline' };
  try {
    const started = Date.now();
    const { status, data } = await postJson(`${env.PISTON_URL.replace(/\/$/, '')}/api/v2/execute`, {
      language: lang,
      version: '*',
      files: [{ name: PISTON_FILE[lang], content: program }],
      run_timeout: 10_000,
      compile_timeout: 20_000,
    });
    const d = (data ?? {}) as {
      run?: { output?: string; signal?: string | null };
      compile?: { code?: number; output?: string };
    };
    if (status !== 200 || !d.run)
      return { ok: false, output: '', ms: null, provider: 'piston', error: 'failed' };
    const compileOut = d.compile && d.compile.code !== 0 ? (d.compile.output ?? '') : '';
    const killed = d.run.signal === 'SIGKILL' ? '\n[timeout]' : '';
    return {
      ok: true,
      output: `${compileOut}${d.run.output ?? ''}${killed}`,
      ms: Date.now() - started,
      provider: 'piston',
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'judge: piston unreachable');
    return { ok: false, output: '', ms: null, provider: 'piston', error: 'timeout' };
  }
}

function exec(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ out: string; ms: number; timedOut: boolean }> {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, timeout: RUN_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const timedOut = Boolean(err && (err as { killed?: boolean }).killed);
        resolve({
          out: `${stdout}${stderr}${timedOut ? '\n[timeout]' : ''}`,
          ms: Date.now() - started,
          timedOut,
        });
      },
    );
  });
}

/** Development only: runs with the machine's python / node / dotnet. */
async function runLocal(lang: JudgeLang, program: string): Promise<RunOutput> {
  if (!env.JUDGE_LOCAL || env.NODE_ENV === 'production')
    return { ok: false, output: '', ms: null, provider: 'local', error: 'offline' };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'judge-'));
  try {
    if (lang === 'python') {
      await writeFile(path.join(dir, 'main.py'), program);
      const r = await exec(process.platform === 'win32' ? 'python' : 'python3', ['main.py'], dir);
      return { ok: true, output: r.out, ms: r.ms, provider: 'local' };
    }
    if (lang === 'javascript') {
      await writeFile(path.join(dir, 'main.js'), program);
      const r = await exec(process.execPath, ['main.js'], dir);
      return { ok: true, output: r.out, ms: r.ms, provider: 'local' };
    }
    await writeFile(
      path.join(dir, 'judge.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><Nullable>disable</Nullable><ImplicitUsings>disable</ImplicitUsings><RollForward>Major</RollForward></PropertyGroup></Project>',
    );
    await writeFile(path.join(dir, 'Main.cs'), program);
    const build = await exec(
      'dotnet',
      ['build', '-c', 'Release', '-o', 'out', '--nologo', '-v', 'q'],
      dir,
    );
    if (!build.out.includes('Build succeeded') && /error CS\d+/.test(build.out))
      return { ok: true, output: build.out, ms: null, provider: 'local' };
    const r = await exec('dotnet', [path.join('out', 'judge.dll')], dir);
    return { ok: true, output: r.out, ms: r.ms, provider: 'local' };
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

/** Runs the program on the first provider that works. */
export async function runProgram(lang: JudgeLang, program: string): Promise<RunOutput> {
  if (env.JUDGE_LOCAL && env.NODE_ENV !== 'production') return runLocal(lang, program);
  const j = await runJdoodle(lang, program);
  if (j.ok) return j;
  const p = await runPiston(lang, program);
  if (p.ok) return p;
  return {
    ok: false,
    output: '',
    ms: null,
    provider: 'none',
    error: j.error === 'quota' ? 'quota' : (p.error ?? j.error),
  };
}

/** True when some provider is configured (the web page says "offline" otherwise). */
export function runnerAvailable(): boolean {
  return Boolean(
    (env.JUDGE_LOCAL && env.NODE_ENV !== 'production') ||
      (env.JDOODLE_CLIENT_ID && env.JDOODLE_CLIENT_SECRET) ||
      env.PISTON_URL,
  );
}
