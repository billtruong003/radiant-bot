"""
Builds src/config/judge-problems.json: the Thiên Kiếp Đài problem bank.

Each problem comes from one billthedev.com/docs/algorithms lesson. Hidden
tests are produced here from a reference solution, so the expected answers
are always right. Big tests are not written out: they are a generator spec
("$gen") that the judge harness expands in the player's language with the
same xorshift32 generator implemented below, which keeps the program sent
to the runner small while still forcing the intended complexity.

    python scripts/build-judge-problems.py
"""

import json
import os
import random
from collections import Counter, deque

OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'config', 'judge-problems.json')
DOCS = '/docs/algorithms/'
CHECKSUM_OVER = 200  # arrays longer than this are compared by checksum
MOD = 1_000_000_007


# ---------------------------------------------------------------- generator


def xs32(seed):
    x = seed & 0xFFFFFFFF or 1
    while True:
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= x >> 17
        x ^= (x << 5) & 0xFFFFFFFF
        yield x


def expand(spec):
    """Same algorithm as the harness generators (src/modules/judge/harness.ts)."""
    if not (isinstance(spec, dict) and '$gen' in spec):
        return spec
    g = xs32(spec['seed'])
    kind = spec['$gen']
    if kind == 'ints':
        lo, hi = spec['lo'], spec['hi']
        return [lo + next(g) % (hi - lo + 1) for _ in range(spec['n'])]
    if kind == 'sorted':  # strictly increasing
        out, v = [], spec['start']
        for _ in range(spec['n']):
            v += 1 + next(g) % spec['gap']
            out.append(v)
        return out
    if kind == 'str':
        a = spec['alphabet']
        return ''.join(a[next(g) % len(a)] for _ in range(spec['n']))
    if kind == 'grid':
        a = spec['alphabet']
        return [''.join(a[next(g) % len(a)] for _ in range(spec['cols'])) for _ in range(spec['rows'])]
    raise ValueError(kind)


def checksum(arr):
    s = 0
    for i, v in enumerate(arr):
        s = (s + (i + 1) * (v % MOD)) % MOD  # Python % is never negative
    return f'#{len(arr)}:{s}'


# ---------------------------------------------------------------- references


def two_sum(nums, target):
    seen = {}
    for i, v in enumerate(nums):
        if target - v in seen:
            return [seen[target - v], i]
        seen[v] = i
    return []


def contains_duplicate(nums):
    return len(set(nums)) != len(nums)


def is_anagram(s, t):
    return Counter(s) == Counter(t)


def valid_parentheses(s):
    pair = {')': '(', ']': '[', '}': '{'}
    st = []
    for c in s:
        if c in '([{':
            st.append(c)
        elif not st or st.pop() != pair[c]:
            return False
    return not st


def is_palindrome(s):
    k = [c.lower() for c in s if c.isalnum()]
    return k == k[::-1]


def binary_search(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        m = (lo + hi) // 2
        if nums[m] == target:
            return m
        if nums[m] < target:
            lo = m + 1
        else:
            hi = m - 1
    return -1


def max_profit(prices):
    best, low = 0, float('inf')
    for p in prices:
        low = min(low, p)
        best = max(best, p - low)
    return best


def max_subarray(nums):
    best = cur = nums[0]
    for v in nums[1:]:
        cur = max(v, cur + v)
        best = max(best, cur)
    return best


def merge_sorted(a, b):
    return sorted(a + b)


def move_zeroes(nums):
    nz = [v for v in nums if v != 0]
    return nz + [0] * (len(nums) - len(nz))


def group_anagrams(strs):
    g = {}
    for s in strs:
        g.setdefault(''.join(sorted(s)), []).append(s)
    return list(g.values())


def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


def climb_stairs(n):
    a, b = 1, 1
    for _ in range(n):
        a, b = b, a + b
    return a


def coin_change(coins, amount):
    INF = amount + 1
    dp = [0] + [INF] * amount
    for x in range(1, amount + 1):
        for c in coins:
            if c <= x and dp[x - c] + 1 < dp[x]:
                dp[x] = dp[x - c] + 1
    return dp[amount] if dp[amount] <= amount else -1


def longest_substring(s):
    last, start, best = {}, 0, 0
    for i, c in enumerate(s):
        if c in last and last[c] >= start:
            start = last[c] + 1
        last[c] = i
        best = max(best, i - start + 1)
    return best


def shortest_path(grid):
    r, c = len(grid), len(grid[0])
    start, end = (0, 0), (r - 1, c - 1)
    if grid[0][0] == '#' or grid[r - 1][c - 1] == '#':
        return -1
    dist = {start: 0}
    q = deque([start])
    while q:
        i, j = q.popleft()
        if (i, j) == end:
            return dist[(i, j)]
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ni, nj = i + di, j + dj
            if 0 <= ni < r and 0 <= nj < c and grid[ni][nj] != '#' and (ni, nj) not in dist:
                dist[(ni, nj)] = dist[(i, j)] + 1
                q.append((ni, nj))
    return -1


def num_islands(grid):
    r, c = len(grid), len(grid[0])
    seen = [[False] * c for _ in range(r)]
    n = 0
    for i in range(r):
        for j in range(c):
            if grid[i][j] == '1' and not seen[i][j]:
                n += 1
                st = [(i, j)]
                seen[i][j] = True
                while st:
                    a, b = st.pop()
                    for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        x, y = a + da, b + db
                        if 0 <= x < r and 0 <= y < c and grid[x][y] == '1' and not seen[x][y]:
                            seen[x][y] = True
                            st.append((x, y))
    return n


def sort_array(nums):
    return sorted(nums)


def top_k(nums, k):
    return [v for v, _ in Counter(nums).most_common(k)]


# ---------------------------------------------------------------- problems

rnd = random.Random(20261006)
PROBLEMS = []


def add(slug, title, difficulty, fn, params, returns, ref, story, statement, constraints, examples,
        hidden, compare='exact'):
    def solve(args):
        real = [expand(a) for a in args]
        out = ref(*[list(x) if isinstance(x, list) else x for x in real])
        if compare == 'exact' and isinstance(out, list) and len(out) > CHECKSUM_OVER:
            return checksum(out)
        return out

    tests = [{'a': a, 'e': solve(a)} for a in hidden]
    PROBLEMS.append({
        'slug': slug,
        'title': title,
        'difficulty': difficulty,
        'docs': DOCS + slug + '/',
        'fn': fn,
        'params': [{'name': n, 'type': t} for n, t in params],
        'returns': returns,
        'compare': compare,
        'story': story,
        'statement': statement,
        'constraints': constraints,
        'examples': [{'a': a, 'e': ref(*a)} for a in examples],
        'tests': tests,
    })


def ints(n, lo, hi):
    return [rnd.randint(lo, hi) for _ in range(n)]


def gen(kind, seed, **kw):
    return {'$gen': kind, 'seed': seed, **kw}


# two-sum: exactly one answer per test, so a plain comparison works.
def two_sum_case(n, lo, hi):
    while True:
        nums = rnd.sample(range(lo, hi), n)
        i, j = sorted(rnd.sample(range(n), 2))
        target = nums[i] + nums[j]
        sums = sum(1 for x in range(n) for y in range(x + 1, n) if nums[x] + nums[y] == target) if n <= 300 else 1
        if sums == 1:
            return [nums, target]


def two_sum_big(n):
    # Distinct odd numbers plus one even pair: only that pair sums to an even target... make it unique by construction.
    # Every other number is at most 200 001, so only the planted pair reaches the target.
    nums = [2 * k + 1 for k in rnd.sample(range(10 ** 5), n - 2)]
    a, b = 1_000_002, 1_500_004
    nums += [a, b]
    rnd.shuffle(nums)
    return [nums, a + b]


add('two-sum', 'Song Kiếm Hợp Bích', 'easy', 'two_sum',
    [('nums', 'int[]'), ('target', 'int')], 'int[]', two_sum,
    'Trong kho của Tàng Kinh Các có một dãy linh thạch, mỗi viên mang một con số linh lực. Trưởng lão cần đúng hai viên mà tổng linh lực bằng con số trận pháp yêu cầu.',
    'Cho mảng nums và số target, trả về chỉ số của hai phần tử khác nhau có tổng bằng target. Mỗi test có đúng một đáp án; trả về hai chỉ số theo thứ tự tăng dần.',
    '2 ≤ n ≤ 10 000. Giá trị tới ±10⁷. Nên làm O(n) bằng bảng băm.',
    [[[2, 7, 11, 15], 9], [[3, 2, 4], 6]],
    [two_sum_case(n, -50, 200) for n in (2, 3, 5, 8, 12, 20, 40, 60, 100, 200)] + [two_sum_big(n) for n in (3000, 10000)] + [[[-3, 4, 3, 90], 0], [[0, 4, 3, 0], 0]],
    'sorted')

add('contains-duplicate', 'Phân Thân Thuật', 'easy', 'contains_duplicate',
    [('nums', 'int[]')], 'bool', contains_duplicate,
    'Một tà tu dùng phân thân thuật trà trộn vào hàng đệ tử. Mỗi đệ tử có một số hiệu, phân thân thì trùng số hiệu với bản thể.',
    'Trả về true nếu mảng có ít nhất một giá trị xuất hiện hai lần trở lên, ngược lại false.',
    '1 ≤ n ≤ 100 000. Cần O(n) hoặc O(n log n).',
    [[[1, 2, 3, 1]], [[1, 2, 3, 4]]],
    [[[1]], [[5, 5]], [[1, 2]], [ints(30, 0, 1000)], [list(range(500))], [list(range(500)) + [250]],
     [gen('ints', 11, n=100000, lo=0, hi=10 ** 9)], [gen('sorted', 12, n=100000, start=0, gap=5)],
     [gen('ints', 13, n=100000, lo=0, hi=50000)], [[-1, -2, -3, -1]], [ints(1000, -10 ** 6, 10 ** 6)],
     [[7, 3, 9, 1, 3]], [[0, 0, 0]], [list(range(-200, 200, 3))], [gen('sorted', 14, n=80000, start=-10 ** 6, gap=3)]])

def ana_case(n, same):
    s = ''.join(rnd.choice('abcde') for _ in range(n))
    t = list(s)
    rnd.shuffle(t)
    t = ''.join(t)
    if not same and n:
        t = t[:-1] + ('z' if t[-1] != 'z' else 'y')
    return [s, t]

add('valid-anagram', 'Đảo Tự Quyết', 'easy', 'is_anagram',
    [('s', 'string'), ('t', 'string')], 'bool', is_anagram,
    'Hai cuộn bí kíp được chép từ cùng một bộ chữ nhưng xáo thứ tự để giấu nghĩa. Xác định hai cuộn có cùng bộ chữ cái không.',
    'Trả về true nếu t là hoán vị các ký tự của s (cùng số lần xuất hiện mỗi ký tự).',
    '1 ≤ độ dài ≤ 100 000, chỉ chữ thường a–z.',
    [['anagram', 'nagaram'], ['rat', 'car']],
    [ana_case(n, same) for n, same in ((1, True), (2, False), (5, True), (10, False), (50, True), (300, True), (300, False), (5000, True))]
    + [['a', 'ab'], ['ab', 'a'], ['aacc', 'ccac'], [gen('str', 21, n=100000, alphabet='abc'), gen('str', 21, n=100000, alphabet='abc')],
       [gen('str', 22, n=100000, alphabet='abcdefghij'), gen('str', 23, n=100000, alphabet='abcdefghij')]])

def paren_case(n, ok):
    st, out = [], []
    pairs = {'(': ')', '[': ']', '{': '}'}
    for _ in range(n):
        if st and rnd.random() < 0.5:
            out.append(pairs[st.pop()])
        else:
            c = rnd.choice('([{')
            st.append(c)
            out.append(c)
    while st:
        out.append(pairs[st.pop()])
    s = ''.join(out)
    if not ok:
        i = rnd.randrange(len(s))
        s = s[:i] + rnd.choice(')]}') + s[i + 1:]
    return [s]

add('valid-parentheses', 'Phong Ấn Trận', 'easy', 'is_valid',
    [('s', 'string')], 'bool', valid_parentheses,
    'Mỗi phong ấn mở ra phải được đóng lại bằng đúng loại ấn, theo đúng thứ tự ngược lại. Một ấn sai là cả trận sụp.',
    'Chuỗi chỉ gồm ()[]{}. Trả về true nếu mọi ngoặc mở được đóng đúng loại và đúng thứ tự.',
    '1 ≤ độ dài ≤ 100 000.',
    [['()[]{}'], ['(]']],
    [['('], [')'], ['(('], ['([)]'], ['{[]}'], [']'], ['()'], ['((()))[]{}']]
    + [paren_case(n, ok) for n, ok in ((20, True), (20, False), (500, True), (500, False), (10000, True), (10000, False))])

def pal_case(n, ok):
    half = ''.join(rnd.choice('abAB12 ,.:') for _ in range(n))
    s = half + half[::-1]
    if not ok:
        s = 'x' + s + 'y'
    return [s]

add('palindrome-hai-con-tro', 'Kính Hoa Thủy Nguyệt', 'easy', 'is_palindrome',
    [('s', 'string')], 'bool', is_palindrome,
    'Câu chú khắc trên gương chỉ linh nghiệm khi đọc xuôi hay ngược đều như nhau, bỏ qua dấu câu, khoảng trắng và chữ hoa thường.',
    'Chỉ giữ chữ cái và chữ số, coi chữ hoa như chữ thường. Trả về true nếu chuỗi còn lại đối xứng.',
    '1 ≤ độ dài ≤ 200 000. Ký tự ASCII in được.',
    [['A man, a plan, a canal: Panama'], ['race a car']],
    [[' '], ['a'], ['ab'], ['aA'], ['0P'], ['.,'], ['No lemon, no melon']]
    + [pal_case(n, ok) for n, ok in ((5, True), (5, False), (100, True), (100, False), (8000, True), (8000, False))])

def bs_case(n, hit):
    nums = sorted(rnd.sample(range(-10 ** 6, 10 ** 6), n))
    t = rnd.choice(nums) if hit else rnd.choice([x for x in range(-10 ** 6, 10 ** 6, 7919) if x not in set(nums)])
    return [nums, t]

add('binary-search', 'Thiên Lý Truy Tung', 'easy', 'search',
    [('nums', 'int[]'), ('target', 'int')], 'int', binary_search,
    'Danh sách đệ tử xếp theo tu vi tăng dần. Tìm vị trí của người có đúng tu vi cần tìm, mỗi lần chỉ được hỏi một người.',
    'nums tăng dần, các phần tử khác nhau. Trả về chỉ số của target, hoặc -1 nếu không có.',
    '1 ≤ n ≤ 100 000.',
    [[[-1, 0, 3, 5, 9, 12], 9], [[-1, 0, 3, 5, 9, 12], 2]],
    [[[5], 5], [[5], 4], [[1, 3], 3], [[1, 3], 0]] + [bs_case(n, h) for n, h in ((10, True), (10, False), (1000, True), (1000, False), (2000, True))]
    + [[gen('sorted', 31, n=100000, start=0, gap=10), 1], [gen('sorted', 32, n=100000, start=-500000, gap=4), 0]])

add('best-time-to-buy-sell', 'Linh Thạch Thị Trường', 'easy', 'max_profit',
    [('prices', 'int[]')], 'int', max_profit,
    'Giá linh thạch ở chợ Vạn Bảo thay đổi mỗi ngày. Bạn được mua một lần rồi bán một lần sau đó. Lãi nhiều nhất là bao nhiêu?',
    'prices[i] là giá ngày i. Trả về lợi nhuận lớn nhất khi mua một ngày và bán ở một ngày sau đó; không có lãi thì trả 0.',
    '1 ≤ n ≤ 100 000, 0 ≤ giá ≤ 10⁴. Cần O(n).',
    [[[7, 1, 5, 3, 6, 4]], [[7, 6, 4, 3, 1]]],
    [[[1]], [[2, 1]], [[1, 2]], [[3, 3, 3]], [ints(20, 0, 50)], [ints(200, 0, 10000)], [list(range(1000, 0, -1))],
     [gen('ints', 41, n=100000, lo=0, hi=10000)], [gen('ints', 42, n=100000, lo=5000, hi=6000)], [[2, 4, 1]], [[3, 2, 6, 5, 0, 3]]])

add('maximum-subarray', 'Tụ Khí Thành Đan', 'medium', 'max_subarray',
    [('nums', 'int[]')], 'int', max_subarray,
    'Dọc mạch linh khí có chỗ dương khí, có chỗ âm khí. Chọn một đoạn liên tiếp để tụ khí, tổng càng lớn đan càng mạnh.',
    'Trả về tổng lớn nhất của một đoạn con liên tiếp khác rỗng.',
    '1 ≤ n ≤ 100 000, giá trị ±10⁴. Cần O(n) (Kadane).',
    [[[-2, 1, -3, 4, -1, 2, 1, -5, 4]], [[5, 4, -1, 7, 8]]],
    [[[1]], [[-1]], [[-2, -1]], [[-3, -2, -5]], [ints(30, -20, 20)], [ints(500, -100, 100)],
     [gen('ints', 51, n=100000, lo=-10000, hi=10000)], [gen('ints', 52, n=100000, lo=-10000, hi=500)], [gen('ints', 53, n=100000, lo=-5, hi=10000)],
     [[0, 0, 0]], [[8, -19, 5, -4, 20]]])

def merge_case(n, m):
    return [sorted(ints(n, -1000, 1000)), sorted(ints(m, -1000, 1000))]

add('merge-sorted-arrays', 'Lưỡng Mạch Hợp Lưu', 'easy', 'merge',
    [('a', 'int[]'), ('b', 'int[]')], 'int[]', merge_sorted,
    'Hai dòng linh mạch đã chảy theo thứ tự từ yếu tới mạnh. Gộp chúng thành một dòng vẫn giữ đúng thứ tự.',
    'a và b đã sắp tăng dần (có thể trùng). Trả về mảng gộp, tăng dần.',
    '0 ≤ n, m ≤ 100 000. Cần O(n + m).',
    [[[1, 2, 4], [1, 3, 4]], [[], [0]]],
    [[[], []], [[1], []], [[], [2, 3]], [[5], [1]]] + [merge_case(n, m) for n, m in ((3, 3), (10, 1), (100, 120), (150, 40))]
    + [[gen('sorted', 61, n=60000, start=0, gap=3), gen('sorted', 62, n=60000, start=0, gap=3)], [gen('sorted', 63, n=100000, start=-10 ** 6, gap=7), [5]]])

add('move-zeroes', 'Thanh Lọc Tạp Chất', 'easy', 'move_zeroes',
    [('nums', 'int[]')], 'int[]', move_zeroes,
    'Trong lò luyện có lẫn tạp chất (số 0). Dồn hết tạp chất về cuối lò, các linh dược giữ nguyên thứ tự.',
    'Đưa mọi số 0 về cuối mảng, giữ thứ tự các số khác 0. Trả về mảng sau khi sắp xếp lại (sửa tại chỗ rồi trả về cũng được).',
    '1 ≤ n ≤ 100 000. Cần O(n).',
    [[[0, 1, 0, 3, 12]], [[0]]],
    [[[1]], [[0, 0, 1]], [[1, 0]], [[4, 2, 4, 0, 0, 3, 0, 5, 1, 0]], [ints(50, 0, 3)], [ints(150, 0, 1)],
     [gen('ints', 71, n=100000, lo=0, hi=4)], [gen('ints', 72, n=100000, lo=0, hi=1)], [[-1, 0, -2]]])

def word():
    return ''.join(rnd.choice('abcd') for _ in range(rnd.randint(1, 4)))

add('group-anagrams', 'Quy Tông Nhận Tổ', 'medium', 'group_anagrams',
    [('strs', 'string[]')], 'string[][]', group_anagrams,
    'Các đệ tử thất lạc mang tên đã bị đảo chữ. Những người cùng bộ chữ là cùng một tông. Gom họ về đúng tông môn.',
    'Nhóm các chuỗi là hoán vị của nhau. Thứ tự các nhóm và thứ tự trong nhóm không quan trọng.',
    '1 ≤ n ≤ 2 000, mỗi chuỗi dài 1–4 (có thể rỗng), chữ thường.',
    [[['eat', 'tea', 'tan', 'ate', 'nat', 'bat']], [['a']]],
    [[['']], [['', '']], [['ab', 'ba', 'abc']], [[word() for _ in range(30)]], [[word() for _ in range(300)]], [[word() for _ in range(3000)]],
     [[word() for _ in range(2000)]], [['abc', 'bca', 'cab', 'xyz', 'zyx', 'q']]],
    'groups')

add('fibonacci-de-quy-va-memo', 'Kim Thiềm Sinh Sôi', 'easy', 'fib',
    [('n', 'int')], 'int', fib,
    'Kim thiềm mỗi năm sinh thêm số con bằng tổng hai năm trước. Năm thứ n có bao nhiêu con?',
    'F(0) = 0, F(1) = 1, F(n) = F(n-1) + F(n-2). Trả về F(n).',
    '0 ≤ n ≤ 45. Đệ quy không ghi nhớ sẽ quá giờ ở n lớn.',
    [[2], [10]],
    [[0], [1], [3], [5], [20], [30], [35], [40], [44], [45], [7], [12]])

add('climbing-stairs', 'Đăng Thiên Thê', 'easy', 'climb_stairs',
    [('n', 'int')], 'int', climb_stairs,
    'Thang lên Thiên Môn có n bậc. Mỗi bước bạn lên 1 hoặc 2 bậc. Có bao nhiêu cách lên tới đỉnh?',
    'Trả về số cách khác nhau để leo hết n bậc.',
    '1 ≤ n ≤ 45.',
    [[2], [3]],
    [[1], [4], [5], [10], [20], [30], [38], [44], [45], [25]])

def coin_case():
    coins = sorted(set(rnd.randint(1, 30) for _ in range(rnd.randint(1, 5))))
    return [coins, rnd.randint(0, 300)]

add('coin-change', 'Đổi Linh Thạch', 'hard', 'coin_change',
    [('coins', 'int[]'), ('amount', 'int')], 'int', coin_change,
    'Chợ chỉ nhận vài mệnh giá linh thạch. Trả đúng một khoản bằng ít viên nhất có thể, hoặc báo không trả được.',
    'Trả về số đồng ít nhất để tạo đúng amount (mỗi mệnh giá dùng không giới hạn). Không tạo được thì trả -1.',
    '1 ≤ số mệnh giá ≤ 12, 1 ≤ mệnh giá ≤ 10⁴, 0 ≤ amount ≤ 10⁴. Cần quy hoạch động O(amount × số mệnh giá).',
    [[[1, 2, 5], 11], [[2], 3]],
    [[[1], 0], [[2], 1], [[1, 2, 5], 100], [[186, 419, 83, 408], 6249], [[3, 7, 405, 436], 8839], [[2, 5, 10, 1], 27]]
    + [coin_case() for _ in range(6)] + [[[7, 13, 29, 31, 101], 10000], [[9973], 10000], [[3, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43], 9999]])

add('longest-substring-no-repeat', 'Vô Trùng Chi Lộ', 'medium', 'length_of_longest_substring',
    [('s', 'string')], 'int', longest_substring,
    'Con đường tu luyện không được lặp lại một tâm pháp. Tìm đoạn đường dài nhất mà mọi tâm pháp đều khác nhau.',
    'Trả về độ dài chuỗi con liên tiếp dài nhất không có ký tự nào lặp lại.',
    '0 ≤ độ dài ≤ 200 000. Cần O(n) bằng cửa sổ trượt.',
    [['abcabcbb'], ['bbbbb']],
    [[''], ['a'], ['au'], ['dvdf'], ['pwwkew'], ['abba'], ['tmmzuxt']]
    + [[''.join(rnd.choice('abcdefgh') for _ in range(n))] for n in (30, 500)]
    + [[gen('str', 81, n=200000, alphabet='abcdefghijklmnopqrstuvwxyz')], [gen('str', 82, n=200000, alphabet='ab')], [gen('str', 83, n=200000, alphabet='abcdefghijklmnopqrstuvwxyz0123456789')]])

def maze(r, c, wall):
    g = [[('#' if rnd.random() < wall else '.') for _ in range(c)] for _ in range(r)]
    g[0][0] = '.'
    g[r - 1][c - 1] = '.'
    return [[''.join(row) for row in g]]

add('bfs-tim-duong-tren-luoi', 'Mê Cung Cửu Khúc', 'hard', 'shortest_path',
    [('grid', 'string[]')], 'int', shortest_path,
    'Bí cảnh là một mê cung. Bạn đứng ở góc trên trái, lối ra ở góc dưới phải, # là vách đá. Tìm số bước ít nhất để thoát ra.',
    "Đi từ ô (0, 0) tới ô dưới cùng bên phải. Mỗi bước đi lên, xuống, trái hoặc phải sang ô '.'. Trả về số bước ít nhất, không tới được (hoặc một trong hai góc là '#') thì -1.",
    '1 ≤ số hàng, số cột ≤ 400. Cần BFS O(số ô).',
    [[['..#', '..#', '#..']], [['.#', '#.']]],
    [[['.']], [['..']], [['.', '.']], [['.#.']], [['#.']]] + [maze(r, c, w) for r, c, w in ((4, 4, 0.2), (10, 10, 0.3), (30, 40, 0.25), (60, 60, 0.35))]
    + [[gen('grid', 91, rows=300, cols=300, alphabet='.....#')], [gen('grid', 92, rows=400, cols=400, alphabet='......#')], [gen('grid', 93, rows=400, cols=400, alphabet='.')]])

def islands(r, c, p):
    return [[''.join('1' if rnd.random() < p else '0' for _ in range(c)) for _ in range(r)]]

add('dem-dao-flood-fill', 'Quần Đảo Phù Không', 'medium', 'num_islands',
    [('grid', 'string[]')], 'int', num_islands,
    "Trên biển mây có những hòn đảo bay. '1' là đất, '0' là mây. Đất nối nhau theo bốn hướng thì cùng một đảo. Đếm số đảo.",
    "Trả về số vùng '1' liên thông theo 4 hướng.",
    '1 ≤ số hàng, số cột ≤ 400.',
    [[['11110', '11010', '11000', '00000']], [['11000', '11000', '00100', '00011']]],
    [[['0']], [['1']], [['101', '010', '101']]] + [islands(r, c, p) for r, c, p in ((5, 5, 0.5), (20, 30, 0.4), (60, 60, 0.5), (100, 100, 0.3))]
    + [[gen('grid', 101, rows=400, cols=400, alphabet='0011')], [gen('grid', 102, rows=400, cols=400, alphabet='1')]])

add('sap-xep-co-ban', 'Bài Binh Bố Trận', 'medium', 'sort_array',
    [('nums', 'int[]')], 'int[]', sort_array,
    'Trước trận, đệ tử phải xếp hàng theo tu vi tăng dần. Bạn là người xếp.',
    'Trả về mảng đã sắp tăng dần.',
    '1 ≤ n ≤ 100 000, giá trị ±10⁹. Bubble sort sẽ quá giờ ở test lớn.',
    [[[5, 2, 3, 1]], [[5, 1, 1, 2, 0, 0]]],
    [[[1]], [[2, 1]], [ints(50, -100, 100)], [ints(200, -10 ** 9, 10 ** 9)], [list(range(200, 0, -1))],
     [gen('ints', 111, n=100000, lo=-10 ** 9, hi=10 ** 9)], [gen('ints', 112, n=100000, lo=0, hi=10)], [gen('sorted', 113, n=100000, start=0, gap=2)]])

def topk_case(distinct, k, maxf):
    vals = rnd.sample(range(-1000, 1000), distinct)
    freq = sorted(rnd.sample(range(1, maxf), distinct), reverse=True)
    nums = [v for v, f in zip(vals, freq) for _ in range(f)]
    rnd.shuffle(nums)
    return [nums, k]

add('top-k-pho-bien', 'Bảng Phong Thần', 'medium', 'top_k_frequent',
    [('nums', 'int[]'), ('k', 'int')], 'int[]', top_k,
    'Thiên Đạo ghi lại mọi lần một cái tên được nhắc tới. k cái tên được nhắc nhiều nhất sẽ lên Bảng Phong Thần.',
    'Trả về k giá trị xuất hiện nhiều nhất, thứ tự tùy ý. Đề đảm bảo đáp án là duy nhất.',
    '1 ≤ n ≤ 100 000, 1 ≤ k ≤ số giá trị khác nhau.',
    [[[1, 1, 1, 2, 2, 3], 2], [[1], 1]],
    [[[4, 4, 5], 1], [[1, 2, 2, 3, 3, 3], 3]] + [topk_case(d, k, n) for d, k, n in ((5, 2, 30), (20, 5, 60), (50, 10, 120), (100, 20, 160))],
    'sorted')

# Top every problem up to MIN_TESTS with small random cases.
MIN_TESTS = 15
EXTRA = {
    'two-sum': lambda: two_sum_case(rnd.randint(2, 30), -100, 100),
    'contains-duplicate': lambda: [ints(rnd.randint(1, 30), 0, 40)],
    'valid-anagram': lambda: ana_case(rnd.randint(1, 20), rnd.random() < 0.5),
    'valid-parentheses': lambda: paren_case(rnd.randint(1, 20), rnd.random() < 0.5),
    'palindrome-hai-con-tro': lambda: pal_case(rnd.randint(1, 15), rnd.random() < 0.5),
    'binary-search': lambda: bs_case(rnd.randint(1, 40), rnd.random() < 0.5),
    'best-time-to-buy-sell': lambda: [ints(rnd.randint(1, 30), 0, 100)],
    'maximum-subarray': lambda: [ints(rnd.randint(1, 30), -50, 50)],
    'merge-sorted-arrays': lambda: merge_case(rnd.randint(0, 20), rnd.randint(0, 20)),
    'move-zeroes': lambda: [ints(rnd.randint(1, 30), 0, 3)],
    'group-anagrams': lambda: [[word() for _ in range(rnd.randint(1, 25))]],
    'fibonacci-de-quy-va-memo': lambda: [rnd.randint(0, 45)],
    'climbing-stairs': lambda: [rnd.randint(1, 45)],
    'coin-change': coin_case,
    'longest-substring-no-repeat': lambda: [''.join(rnd.choice('abcxyz') for _ in range(rnd.randint(0, 40)))],
    'bfs-tim-duong-tren-luoi': lambda: maze(rnd.randint(1, 12), rnd.randint(1, 12), 0.3),
    'dem-dao-flood-fill': lambda: islands(rnd.randint(1, 12), rnd.randint(1, 12), 0.45),
    'sap-xep-co-ban': lambda: [ints(rnd.randint(1, 40), -1000, 1000)],
    'top-k-pho-bien': lambda: topk_case(rnd.randint(2, 8), 1, 20),
}
REFS = {
    'two-sum': two_sum, 'contains-duplicate': contains_duplicate, 'valid-anagram': is_anagram,
    'valid-parentheses': valid_parentheses, 'palindrome-hai-con-tro': is_palindrome, 'binary-search': binary_search,
    'best-time-to-buy-sell': max_profit, 'maximum-subarray': max_subarray, 'merge-sorted-arrays': merge_sorted,
    'move-zeroes': move_zeroes, 'group-anagrams': group_anagrams, 'fibonacci-de-quy-va-memo': fib,
    'climbing-stairs': climb_stairs, 'coin-change': coin_change, 'longest-substring-no-repeat': longest_substring,
    'bfs-tim-duong-tren-luoi': shortest_path, 'dem-dao-flood-fill': num_islands, 'sap-xep-co-ban': sort_array,
    'top-k-pho-bien': top_k,
}
for prob in PROBLEMS:
    while len(prob['tests']) < MIN_TESTS:
        args = EXTRA[prob['slug']]()
        prob['tests'].insert(len(prob['tests']) // 2, {'a': args, 'e': REFS[prob['slug']](*args)})

with open(OUT, 'w', encoding='utf8') as f:
    json.dump({'$schema': 'judge-problems-v1', 'checksumOver': CHECKSUM_OVER, 'problems': PROBLEMS}, f, ensure_ascii=False, separators=(',', ':'))
    f.write('\n')
size = os.path.getsize(OUT)
print(f'{len(PROBLEMS)} problems, {sum(len(p["tests"]) for p in PROBLEMS)} hidden tests, {size // 1024} KB')
