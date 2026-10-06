/**
 * Known-good solutions in all three judge languages, used to check that the
 * harness (generators, checksums, compare modes) agrees with the problem
 * builder. One problem per input/compare shape.
 */
export const SOLUTIONS: Record<string, { python: string; javascript: string; csharp: string }> = {
  'two-sum': {
    python: `def two_sum(nums, target):
    seen = {}
    for i, v in enumerate(nums):
        if target - v in seen:
            return [seen[target - v], i]
        seen[v] = i
    return []
`,
    javascript: `function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    if (seen.has(target - nums[i])) return [i, seen.get(target - nums[i])];
    seen.set(nums[i], i);
  }
  return [];
}
`,
    csharp: `using System.Collections.Generic;
public class Solution {
    public int[] TwoSum(int[] nums, int target) {
        var seen = new Dictionary<int, int>();
        for (int i = 0; i < nums.Length; i++) {
            if (seen.TryGetValue(target - nums[i], out var j)) return new[] { j, i };
            seen[nums[i]] = i;
        }
        return new int[0];
    }
}
`,
  },
  'contains-duplicate': {
    python: `def contains_duplicate(nums):
    return len(set(nums)) != len(nums)
`,
    javascript: `const containsDuplicate = (nums) => new Set(nums).size !== nums.length;
`,
    csharp: `public class Solution {
    public bool ContainsDuplicate(int[] nums) => new HashSet<int>(nums).Count != nums.Length;
}
`,
  },
  'valid-anagram': {
    python: `from collections import Counter
def is_anagram(s, t):
    return Counter(s) == Counter(t)
`,
    javascript: `function isAnagram(s, t) {
  if (s.length !== t.length) return false;
  const c = {};
  for (const ch of s) c[ch] = (c[ch] || 0) + 1;
  for (const ch of t) { if (!c[ch]) return false; c[ch]--; }
  return true;
}
`,
    csharp: `public class Solution {
    public bool IsAnagram(string s, string t) {
        if (s.Length != t.Length) return false;
        var c = new int[128];
        foreach (var ch in s) c[ch]++;
        foreach (var ch in t) if (--c[ch] < 0) return false;
        return true;
    }
}
`,
  },
  'merge-sorted-arrays': {
    python: `def merge(a, b):
    return sorted(a + b)
`,
    javascript: `function merge(a, b) {
  const o = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) o.push(j >= b.length || (i < a.length && a[i] <= b[j]) ? a[i++] : b[j++]);
  return o;
}
`,
    csharp: `public class Solution {
    public int[] Merge(int[] a, int[] b) {
        var o = new int[a.Length + b.Length]; int i = 0, j = 0, k = 0;
        while (i < a.Length || j < b.Length) o[k++] = j >= b.Length || (i < a.Length && a[i] <= b[j]) ? a[i++] : b[j++];
        return o;
    }
}
`,
  },
  'move-zeroes': {
    python: `def move_zeroes(nums):
    nz = [v for v in nums if v != 0]
    return nz + [0] * (len(nums) - len(nz))
`,
    javascript: `function moveZeroes(nums) {
  let w = 0;
  for (const v of nums) if (v !== 0) nums[w++] = v;
  while (w < nums.length) nums[w++] = 0;
  return nums;
}
`,
    csharp: `public class Solution {
    public int[] MoveZeroes(int[] nums) {
        int w = 0;
        foreach (var v in nums.ToArray()) if (v != 0) nums[w++] = v;
        while (w < nums.Length) nums[w++] = 0;
        return nums;
    }
}
`,
  },
  'group-anagrams': {
    python: `def group_anagrams(strs):
    g = {}
    for s in strs:
        g.setdefault("".join(sorted(s)), []).append(s)
    return list(g.values())
`,
    javascript: `function groupAnagrams(strs) {
  const g = new Map();
  for (const s of strs) { const k = [...s].sort().join(''); if (!g.has(k)) g.set(k, []); g.get(k).push(s); }
  return [...g.values()];
}
`,
    csharp: `public class Solution {
    public IList<IList<string>> GroupAnagrams(string[] strs) {
        var g = new Dictionary<string, IList<string>>();
        foreach (var s in strs) {
            var a = s.ToCharArray(); Array.Sort(a); var k = new string(a);
            if (!g.ContainsKey(k)) g[k] = new List<string>();
            g[k].Add(s);
        }
        return g.Values.ToList();
    }
}
`,
  },
  'bfs-tim-duong-tren-luoi': {
    python: `from collections import deque
def shortest_path(grid):
    r, c = len(grid), len(grid[0])
    if grid[0][0] == "#" or grid[r - 1][c - 1] == "#":
        return -1
    dist = [[-1] * c for _ in range(r)]
    dist[0][0] = 0
    q = deque([(0, 0)])
    while q:
        i, j = q.popleft()
        if (i, j) == (r - 1, c - 1):
            return dist[i][j]
        for a, b in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
            if 0 <= a < r and 0 <= b < c and grid[a][b] != "#" and dist[a][b] < 0:
                dist[a][b] = dist[i][j] + 1
                q.append((a, b))
    return -1
`,
    javascript: `function shortestPath(grid) {
  const r = grid.length, c = grid[0].length;
  if (grid[0][0] === '#' || grid[r - 1][c - 1] === '#') return -1;
  const d = new Int32Array(r * c).fill(-1); d[0] = 0;
  const q = new Int32Array(r * c); let h = 0, t = 0; q[t++] = 0;
  while (h < t) {
    const cur = q[h++], i = (cur / c) | 0, j = cur % c;
    if (i === r - 1 && j === c - 1) return d[cur];
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (a >= 0 && a < r && b >= 0 && b < c && grid[a][b] !== '#' && d[a * c + b] < 0) { d[a * c + b] = d[cur] + 1; q[t++] = a * c + b; }
    }
  }
  return -1;
}
`,
    csharp: `public class Solution {
    public int ShortestPath(string[] grid) {
        int r = grid.Length, c = grid[0].Length;
        if (grid[0][0] == '#' || grid[r - 1][c - 1] == '#') return -1;
        var d = new int[r * c]; for (int k = 0; k < d.Length; k++) d[k] = -1; d[0] = 0;
        var q = new Queue<int>(); q.Enqueue(0);
        int[] di = { 1, -1, 0, 0 }, dj = { 0, 0, 1, -1 };
        while (q.Count > 0) {
            int cur = q.Dequeue(), i = cur / c, j = cur % c;
            if (i == r - 1 && j == c - 1) return d[cur];
            for (int k = 0; k < 4; k++) {
                int a = i + di[k], b = j + dj[k];
                if (a >= 0 && a < r && b >= 0 && b < c && grid[a][b] != '#' && d[a * c + b] < 0) { d[a * c + b] = d[cur] + 1; q.Enqueue(a * c + b); }
            }
        }
        return -1;
    }
}
`,
  },
  'top-k-pho-bien': {
    python: `from collections import Counter
def top_k_frequent(nums, k):
    return [v for v, _ in Counter(nums).most_common(k)]
`,
    javascript: `function topKFrequent(nums, k) {
  const c = new Map();
  for (const v of nums) c.set(v, (c.get(v) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map((e) => e[0]);
}
`,
    csharp: `public class Solution {
    public int[] TopKFrequent(int[] nums, int k) =>
        nums.GroupBy(v => v).OrderByDescending(g => g.Count()).Take(k).Select(g => g.Key).ToArray();
}
`,
  },
  'sap-xep-co-ban': {
    python: `def sort_array(nums):
    return sorted(nums)
`,
    javascript: `const sortArray = (nums) => nums.sort((a, b) => a - b);
`,
    csharp: `public class Solution {
    public int[] SortArray(int[] nums) { Array.Sort(nums); return nums; }
}
`,
  },
  'longest-substring-no-repeat': {
    python: `def length_of_longest_substring(s):
    last, start, best = {}, 0, 0
    for i, ch in enumerate(s):
        if last.get(ch, -1) >= start:
            start = last[ch] + 1
        last[ch] = i
        best = max(best, i - start + 1)
    return best
`,
    javascript: `function lengthOfLongestSubstring(s) {
  const last = new Map(); let start = 0, best = 0;
  for (let i = 0; i < s.length; i++) {
    if (last.has(s[i]) && last.get(s[i]) >= start) start = last.get(s[i]) + 1;
    last.set(s[i], i); best = Math.max(best, i - start + 1);
  }
  return best;
}
`,
    csharp: `public class Solution {
    public int LengthOfLongestSubstring(string s) {
        var last = new Dictionary<char, int>(); int start = 0, best = 0;
        for (int i = 0; i < s.Length; i++) {
            if (last.TryGetValue(s[i], out var p) && p >= start) start = p + 1;
            last[s[i]] = i; best = Math.Max(best, i - start + 1);
        }
        return best;
    }
}
`,
  },
};

/** Deliberately wrong / slow answers, to check verdicts. */
export const BAD = {
  wrong: `def sort_array(nums):
    return nums
`,
  crash: `def sort_array(nums):
    return nums[len(nums) + 5]
`,
  syntax: `def sort_array(nums)
    return nums
`,
  forgedLine: `def sort_array(nums):
    print("@@Rdeadbeef 0 [1,2,3,5]")
    return nums
`,
};
