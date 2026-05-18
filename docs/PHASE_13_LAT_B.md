# Phase 13 Lát B — Skill catalog follow-ups

> Sub-Lát to Phase 13 (Radiant Arena). Bot-side polish following Lát A (bản mệnh
> forge) + catalog expansion to 12 weapons (commit `a1466c2`).

---

## Goal

After Lát A + the 12-weapon catalog expansion, two follow-ups are needed bot-side:

1. **Lazy-fill migration** — bản mệnh rows forged BEFORE `a1466c2` lack
   `custom_skills`. They load as `undefined` from snapshot/WAL. `forgeBanMenh`
   already returns the existing row on idempotent re-call — extend that branch
   to detect missing `custom_skills` + backfill in-place from hash.
2. **`/arena inspect` extension** — show the bản mệnh skill on inspect embed,
   so users can see what "mạch" they rolled. Read from `UserWeapon.custom_skills[0]`.

Server-side skill execution engine (`arena-server/src/weapons/skills.ts`)
is OUT OF SCOPE — separate Lát (arena-server D.7 or similar), much bigger.

---

## Scope

| Sub | What | File |
|---|---|---|
| 1 | `forgeBanMenh` existing-branch backfill `custom_skills` if missing | `src/modules/arena/forge.ts` |
| 2 | `/arena inspect` displays bản mệnh skill_id + short Vietnamese description | `src/commands/arena.ts` |

(`/arena catalog` browse 12 weapons — DEFER to a later Lát.)

---

## Acceptance

- Existing user runs `/arena forge` → bot detects missing `custom_skills`, rolls from hash, writes back, logs `backfilled bản mệnh skill`.
- `/arena inspect <user with bản mệnh>` → embed shows extra "🩸 Mạch: <name>" field with short description.
- No breaking change for new forges (already populated).
- TypeScript happy (skip live typecheck — no node_modules locally per session).

---

## Skill display names (Vietnamese, for embed)

| skill_id | Embed text |
|---|---|
| `ban_menh_phong_mach` | Phong mạch — phát đầu mỗi trận +30% sát thương |
| `ban_menh_huyet_mach` | Huyết mạch — hồi 5 sinh lực mỗi lượt |
| `ban_menh_loi_mach` | Lôi mạch — base tỷ lệ chí mạng +5% |
| `ban_menh_kim_mach` | Kim mạch — uy lực +10%, độ nảy −10% |
| `ban_menh_moc_mach` | Mộc mạch — mỗi 2 lượt cộng 1 stack "mộc khí", 3 stacks hồi 15 hp |

---

## Commits

1. `feat(arena/forge): backfill custom_skills on existing bản mệnh rows`
2. `feat(arena/inspect): show bản mệnh skill ('mạch') in inspect embed`

---

## Out of scope (deferred)

- `/arena catalog` browse command — would be useful but not blocking. Future small Lát.
- Server-side skill execution wiring — needs D.5 physics + careful design per skill.
- Migration unit tests — forge.ts has no test file; whole-file test scaffold is its own task.
