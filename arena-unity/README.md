# Radiant Arena Unity Client — Setup Guide

> Folder này chứa **docs + skill file** để Bill mang qua project Unity riêng. Unity project tự nó **không sống ở đây** (vì Unity asset DB + .meta files không hợp với git monorepo). Đây là blueprint Bill sao chép sang lúc tạo project Unity mới.

---

## Vì sao folder này không chứa code Unity?

Unity projects có:
- 1 GB+ Library/ folder (artifact, không commit).
- `*.meta` GUID files (Unity asset DB).
- ProjectSettings/ với binary YAML.
- Cấu trúc folder cứng (Assets/, Packages/, ProjectSettings/).

Không tương thích với monorepo của bot. Thay vào đó, Bill tạo Unity project ở location riêng (ví dụ `~/projects/radiant-arena-unity`), rồi copy 4 file Docs từ monorepo sang.

---

## Setup khi tạo Unity project

```bash
# 1. Tạo Unity project mới
# Unity Hub → New Project → Unity 6.0 LTS → Universal 3D template
# Tên: radiant-arena-unity
# Location: ~/projects/radiant-arena-unity (KHÔNG nested trong monorepo)

cd ~/projects/radiant-arena-unity

# 2. Tạo Docs/ folder và copy 4 doc từ monorepo
mkdir Docs
cp /path/to/radiant-tech-sect-bot/arena-unity/SKILL.md Docs/
cp /path/to/radiant-tech-sect-bot/arena-unity/TASKS.md Docs/
cp /path/to/radiant-tech-sect-bot/docs/RADIANT_ARENA_UNITY.md Docs/
cp /path/to/radiant-tech-sect-bot/docs/RADIANT_ARENA_ARCHITECTURE.md Docs/
cp /path/to/radiant-tech-sect-bot/docs/RADIANT_ARENA_COLYSEUS.md Docs/

# 3. Paste BillGameCore API reference từ session context
nano Docs/BILLGAMECORE_API.md  # paste full content

# 4. Git init (separate repo)
git init
echo -e "Library/\nTemp/\nObj/\nBuild/\nLogs/\nUserSettings/\n.vsconfig\n*.csproj\n*.sln\n" > .gitignore
git add Docs/ Assets/ Packages/ ProjectSettings/ .gitignore
git commit -m "feat: Unity project bootstrap"
```

---

## Workflow khi vào Unity project với Claude Code

1. Mở Claude Code CLI trong folder `radiant-arena-unity/`.
2. Specify model `claude-sonnet-4-6` (Sonnet phù hợp Unity work — Opus overkill).
3. **Paste `Docs/SKILL.md` làm tin nhắn đầu tiên** — Claude load persona "Senior Unity 6 client developer".
4. Yêu cầu: "Implement Lát D.U2 từ Docs/TASKS.md".
5. Claude sẽ:
   - Đọc Lát đó trong TASKS.md.
   - Đọc references trong Docs/ (RADIANT_ARENA_UNITY + BILLGAMECORE_API + ARCHITECTURE).
   - List sub-tasks qua TodoWrite trước khi viết code.
   - Đợi Bill confirm hoặc chỉnh trước khi implement.
   - Implement + test + verify.
   - Commit.

`SKILL.md` chứa toàn bộ persona, coding principles, anti-patterns, definition-of-done. Đọc 1 lần là Claude operate đúng style cả session.

---

## Tổng quan project Unity

```
radiant-arena-unity/                  # separate Unity project (not in monorepo)
├── Assets/
│   ├── RadiantArena/                  # game code
│   │   ├── Scenes/ArenaScene.unity
│   │   ├── Scripts/                   # see Docs/RADIANT_ARENA_UNITY.md §1.3
│   │   ├── Prefabs/Weapons/
│   │   ├── Materials/
│   │   ├── Shaders/                   # 10 HLSL shaders (Lát D.U9)
│   │   ├── Resources/
│   │   └── Settings/
│   └── ColyseusSDK/                   # from package manager
├── Packages/                          # Unity package manifest
├── ProjectSettings/                   # Unity project config
├── Docs/                              # ← copied from monorepo
│   ├── SKILL.md                       # ← THIS folder's SKILL.md
│   ├── TASKS.md                       # ← THIS folder's TASKS.md
│   ├── RADIANT_ARENA_UNITY.md
│   ├── RADIANT_ARENA_ARCHITECTURE.md
│   ├── RADIANT_ARENA_COLYSEUS.md
│   └── BILLGAMECORE_API.md
└── .gitignore                         # Library/, Temp/, etc.
```

---

## Tại sao Sonnet (not Opus)?

Bill specify `file này sẽ được execute với sonnet ở bển`.

Lý do:
- Unity C# code is verbose but mostly mechanical — Sonnet handles it well.
- Many small changes per Lát (component, state, UI panel) — Sonnet's speed compounds.
- Opus saves cost for the truly hard architectural decisions, which are already resolved at this stage (in the architecture doc).
- Bill's quote: "execute với sonnet ở bển" — explicit choice.

If a Lát turns out unexpectedly complex (e.g., complex shader debug), Bill can swap to Opus mid-session via `/model`.

---

## Network architecture position

```
arena-server (Vietnix VPS :2567)
       ▲
       │ WSS với HMAC token
       │
   THIS PROJECT
   (Unity WebGL → Cloudflare Pages)
       │
       │ Player browser navigates to
       │ arena.billthedev.com/?room=X&t=Y
       ▼
   Discord bot DM (Lát A bot side đã ship — sẵn sàng gửi link)
```

---

## Status hiện tại

**Lát D.U1 chưa start** — Unity project chưa được tạo. Steps đầu tiên ở "Setup khi tạo Unity project" section trên.

Khi Unity project đã có:
- Lát D.U1 = bootstrap (install packages, GameBootstrap.cs).
- Lát D.U2+ = build features per `TASKS.md`.

---

## References

| File | Khi nào đọc |
|---|---|
| `SKILL.md` | Mỗi session đầu tiên với Claude — load persona |
| `TASKS.md` | Khi bắt đầu Lát mới |
| `Docs/RADIANT_ARENA_UNITY.md` (sau khi copy) | Implementation walkthrough với code skeletons |
| `Docs/BILLGAMECORE_API.md` (sau khi copy) | Bill.X service reference |
| `Docs/RADIANT_ARENA_ARCHITECTURE.md` (sau khi copy) | Contract spec |
| `Docs/RADIANT_ARENA_COLYSEUS.md` (sau khi copy) | Server side reference |

---

## Sync với monorepo

Khi `arena-unity/SKILL.md` hoặc `arena-unity/TASKS.md` trong monorepo update, Bill cần re-copy sang Unity project's Docs/. Tự động hoá lúc cần (git submodule hoặc symlink) — Phase 2 concern.
