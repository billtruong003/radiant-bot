import {
  type GenSpec,
  type JudgeCase,
  type JudgeProblem,
  type ParamType,
  type ReturnType,
  csName,
  isGen,
  jsName,
} from '../../config/judge-problems.js';

/**
 * Wraps a player's solution and every test into ONE program, so a submit
 * costs one run on the code runner. The program prints one line per test:
 *
 *   @@R<nonce> <index> <json result>
 *   @@E<nonce> <index> <error>
 *
 * The nonce is fresh per run, so printing fake result lines from player
 * code does not help. Expected answers never go into the program; the bot
 * compares the printed results itself (see judge.ts). Big inputs are sent
 * as generator specs and expanded by the same xorshift32 the problem
 * builder used (scripts/build-judge-problems.py), and long array results
 * come back as a checksum.
 */

export type JudgeLang = 'python' | 'javascript' | 'csharp';
export const JUDGE_LANGS: JudgeLang[] = ['python', 'javascript', 'csharp'];
export const LANG_LABEL: Record<JudgeLang, string> = {
  python: 'Python 3',
  javascript: 'JavaScript (Node)',
  csharp: 'C#',
};

const CS_TYPE: Record<ReturnType, string> = {
  int: 'int',
  'int[]': 'int[]',
  string: 'string',
  'string[]': 'string[]',
  bool: 'bool',
  'string[][]': 'IList<IList<string>>',
};

const DEFAULT_RETURN: Record<JudgeLang, Record<ReturnType, string>> = {
  python: {
    int: '0',
    'int[]': '[]',
    string: '""',
    'string[]': '[]',
    bool: 'False',
    'string[][]': '[]',
  },
  javascript: {
    int: '0',
    'int[]': '[]',
    string: '""',
    'string[]': '[]',
    bool: 'false',
    'string[][]': '[]',
  },
  csharp: {
    int: '0',
    'int[]': 'new int[0]',
    string: '""',
    'string[]': 'new string[0]',
    bool: 'false',
    'string[][]': 'new List<IList<string>>()',
  },
};

/** The code the editor starts with. */
export function starterCode(p: JudgeProblem, lang: JudgeLang): string {
  const names = p.params.map((x) => x.name);
  const ret = DEFAULT_RETURN[lang][p.returns];
  if (lang === 'python')
    return `def ${p.fn}(${names.join(', ')}):\n    # Viết lời giải ở đây\n    return ${ret}\n`;
  if (lang === 'javascript')
    return `function ${jsName(p.fn)}(${names.join(', ')}) {\n  // Viết lời giải ở đây\n  return ${ret};\n}\n`;
  const args = p.params.map((x) => `${CS_TYPE[x.type]} ${x.name}`).join(', ');
  return `public class Solution {\n    public ${CS_TYPE[p.returns]} ${csName(p.fn)}(${args}) {\n        // Viết lời giải ở đây\n        return ${ret};\n    }\n}\n`;
}

/** Name the program must define, per language. */
export function entryName(p: JudgeProblem, lang: JudgeLang): string {
  return lang === 'python'
    ? p.fn
    : lang === 'javascript'
      ? jsName(p.fn)
      : `Solution.${csName(p.fn)}`;
}

const pyStr = (json: string): string => JSON.stringify(json);

function pythonProgram(
  p: JudgeProblem,
  code: string,
  cases: JudgeCase[],
  nonce: string,
  over: number,
): string {
  const data = pyStr(JSON.stringify(cases.map((c) => c.a)));
  return `import json as __json
${code}

def __xs(seed):
    x = (seed & 0xFFFFFFFF) or 1
    while True:
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= x >> 17
        x ^= (x << 5) & 0xFFFFFFFF
        yield x

def __x(v):
    if not (isinstance(v, dict) and "$gen" in v):
        return v
    g = __xs(v["seed"])
    k = v["$gen"]
    if k == "ints":
        r = v["hi"] - v["lo"] + 1
        return [v["lo"] + next(g) % r for _ in range(v["n"])]
    if k == "sorted":
        out, cur = [], v["start"]
        for _ in range(v["n"]):
            cur += 1 + next(g) % v["gap"]
            out.append(cur)
        return out
    a = v["alphabet"]
    if k == "str":
        return "".join(a[next(g) % len(a)] for _ in range(v["n"]))
    return ["".join(a[next(g) % len(a)] for _ in range(v["cols"])) for _ in range(v["rows"])]

def __out(r):
    if ${p.compare === 'exact' ? 'True' : 'False'} and isinstance(r, (list, tuple)) and len(r) > ${over}:
        s = 0
        for i, v in enumerate(r):
            s = (s + (i + 1) * (v % 1000000007)) % 1000000007
        return "#%d:%d" % (len(r), s)
    return list(r) if isinstance(r, tuple) else r

for __i, __a in enumerate(__json.loads(${data})):
    try:
        __r = ${p.fn}(*[__x(v) for v in __a])
        print("@@R${nonce} %d %s" % (__i, __json.dumps(__out(__r), separators=(",", ":"))), flush=True)
    except BaseException as __e:
        print("@@E${nonce} %d %s" % (__i, (type(__e).__name__ + ": " + str(__e))[:200].replace("\\n", " ")), flush=True)
`;
}

function jsProgram(
  p: JudgeProblem,
  code: string,
  cases: JudgeCase[],
  nonce: string,
  over: number,
): string {
  const data = JSON.stringify(JSON.stringify(cases.map((c) => c.a)));
  const fn = jsName(p.fn);
  return `${code}
;(function () {
  function xs(seed) {
    let x = (seed >>> 0) || 1;
    return function () {
      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      return x;
    };
  }
  function expand(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || !('$gen' in v)) return v;
    const g = xs(v.seed);
    if (v.$gen === 'ints') { const r = v.hi - v.lo + 1; const o = new Array(v.n); for (let i = 0; i < v.n; i++) o[i] = v.lo + (g() % r); return o; }
    if (v.$gen === 'sorted') { const o = new Array(v.n); let c = v.start; for (let i = 0; i < v.n; i++) { c += 1 + (g() % v.gap); o[i] = c; } return o; }
    const a = v.alphabet;
    const line = function (n) { let s = ''; for (let i = 0; i < n; i++) s += a[g() % a.length]; return s; };
    if (v.$gen === 'str') return line(v.n);
    const rows = []; for (let r = 0; r < v.rows; r++) rows.push(line(v.cols)); return rows;
  }
  function out(r) {
    if (${p.compare === 'exact'} && Array.isArray(r) && r.length > ${over}) {
      const M = 1000000007; let s = 0;
      for (let i = 0; i < r.length; i++) s = (s + (i + 1) * (((r[i] % M) + M) % M)) % M;
      return '#' + r.length + ':' + s;
    }
    return r;
  }
  const T = JSON.parse(${data});
  for (let i = 0; i < T.length; i++) {
    try {
      const r = ${fn}.apply(null, T[i].map(expand));
      console.log('@@R${nonce} ' + i + ' ' + JSON.stringify(out(r)));
    } catch (e) {
      console.log('@@E${nonce} ' + i + ' ' + String((e && e.name) || 'Error') + ': ' + String((e && e.message) || e).slice(0, 200).replace(/\\n/g, ' '));
    }
  }
})();
`;
}

function csString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (c < 32 || c > 126) out += `\\u${c.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

function csGen(v: GenSpec): string {
  switch (v.$gen) {
    case 'ints':
      return `__J.Ints(${v.seed}, ${v.n}, ${v.lo}, ${v.hi})`;
    case 'sorted':
      return `__J.Sorted(${v.seed}, ${v.n}, ${v.start}, ${v.gap})`;
    case 'str':
      return `__J.Str(${v.seed}, ${v.n}, ${csString(v.alphabet)})`;
    case 'grid':
      return `__J.Grid(${v.seed}, ${v.rows}, ${v.cols}, ${csString(v.alphabet)})`;
  }
}

function csLiteral(v: unknown, t: ParamType): string {
  if (isGen(v)) return csGen(v);
  switch (t) {
    case 'int':
      return String(Number(v) | 0);
    case 'bool':
      return v ? 'true' : 'false';
    case 'string':
      return csString(String(v));
    case 'int[]':
      return `new int[] {${(v as number[]).map((x) => String(x | 0)).join(',')}}`;
    case 'string[]':
      return `new string[] {${(v as string[]).map(csString).join(',')}}`;
  }
}

function csharpProgram(
  p: JudgeProblem,
  code: string,
  cases: JudgeCase[],
  nonce: string,
  over: number,
): string {
  const fn = csName(p.fn);
  const calls = cases
    .map((c, i) => {
      const args = c.a.map((v, k) => csLiteral(v, p.params[k]?.type ?? 'int')).join(', ');
      return `        try { var __r = __s.${fn}(${args}); Console.WriteLine("@@R${nonce} ${i} " + __J.Out(__r, ${p.compare === 'exact'})); }
        catch (Exception __e) { Console.WriteLine("@@E${nonce} ${i} " + __J.Err(__e)); }`;
    })
    .join('\n');
  // Player usings first: C# needs every using before any type.
  const usings: string[] = [];
  const body = code
    .split('\n')
    .filter((l) => {
      if (/^\s*using\s+[\w.]+\s*;\s*$/.test(l)) {
        usings.push(l.trim());
        return false;
      }
      return true;
    })
    .join('\n');
  return `using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
${[...new Set(usings)].filter((u) => !/^using System(\.Collections(\.Generic)?|\.Linq|\.Text)?;$/.test(u)).join('\n')}

${body}

public static class __J {
    static uint __x;
    static uint Next() { __x ^= __x << 13; __x ^= __x >> 17; __x ^= __x << 5; return __x; }
    static void Seed(long s) { __x = (uint)(s & 0xFFFFFFFF); if (__x == 0) __x = 1; }
    public static int[] Ints(long seed, int n, long lo, long hi) {
        Seed(seed); var o = new int[n]; ulong r = (ulong)(hi - lo + 1);
        for (int i = 0; i < n; i++) o[i] = (int)(lo + (long)(Next() % r));
        return o;
    }
    public static int[] Sorted(long seed, int n, long start, long gap) {
        Seed(seed); var o = new int[n]; long c = start;
        for (int i = 0; i < n; i++) { c += 1 + (long)(Next() % (ulong)gap); o[i] = (int)c; }
        return o;
    }
    static string Line(int n, string a) { var sb = new StringBuilder(n); for (int i = 0; i < n; i++) sb.Append(a[(int)(Next() % (uint)a.Length)]); return sb.ToString(); }
    public static string Str(long seed, int n, string a) { Seed(seed); return Line(n, a); }
    public static string[] Grid(long seed, int rows, int cols, string a) {
        Seed(seed); var o = new string[rows]; for (int r = 0; r < rows; r++) o[r] = Line(cols, a); return o;
    }
    static string Q(string s) {
        var sb = new StringBuilder("\\"");
        foreach (char ch in s) {
            if (ch == '"') sb.Append("\\\\\\""); else if (ch == '\\\\') sb.Append("\\\\\\\\");
            else if (ch < 32 || ch > 126) sb.Append("\\\\u" + ((int)ch).ToString("x4"));
            else sb.Append(ch);
        }
        return sb.Append('"').ToString();
    }
    public static string J(object o) {
        if (o == null) return "null";
        if (o is bool) return (bool)o ? "true" : "false";
        if (o is string) return Q((string)o);
        if (o is IEnumerable) { var parts = new List<string>(); foreach (var x in (IEnumerable)o) parts.Add(J(x)); return "[" + string.Join(",", parts) + "]"; }
        return Convert.ToString(o, System.Globalization.CultureInfo.InvariantCulture);
    }
    public static string Out(object o, bool exact) {
        if (exact && o is IList && !(o is string) && ((IList)o).Count > ${over}) {
            var l = (IList)o; long M = 1000000007, s = 0;
            for (int i = 0; i < l.Count; i++) { long v = Convert.ToInt64(l[i]); s = (s + (i + 1L) * (((v % M) + M) % M)) % M; }
            return "\\"#" + l.Count + ":" + s + "\\"";
        }
        return J(o);
    }
    public static string Err(Exception e) {
        var m = e.GetType().Name + ": " + e.Message;
        return (m.Length > 200 ? m.Substring(0, 200) : m).Replace("\\n", " ");
    }
    public static void Main() {
        var __s = new Solution();
${calls}
    }
}
`;
}

export function buildProgram(
  p: JudgeProblem,
  lang: JudgeLang,
  code: string,
  cases: JudgeCase[],
  nonce: string,
  checksumOver: number,
): string {
  if (lang === 'python') return pythonProgram(p, code, cases, nonce, checksumOver);
  if (lang === 'javascript') return jsProgram(p, code, cases, nonce, checksumOver);
  return csharpProgram(p, code, cases, nonce, checksumOver);
}

export interface ParsedRun {
  results: Map<number, string>;
  errors: Map<number, string>;
  /** Everything the program printed that is not a result line (player prints, compiler output). */
  other: string;
}

export function parseRun(output: string, nonce: string): ParsedRun {
  const results = new Map<number, string>();
  const errors = new Map<number, string>();
  const other: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^@@([RE])(\S+) (\d+) (.*)$/.exec(line);
    if (m && m[2] === nonce) {
      const idx = Number(m[3]);
      if (m[1] === 'R' && !results.has(idx)) results.set(idx, m[4] ?? '');
      else if (m[1] === 'E' && !errors.has(idx)) errors.set(idx, m[4] ?? '');
    } else if (line.trim()) other.push(line);
  }
  return { results, errors, other: other.join('\n') };
}
