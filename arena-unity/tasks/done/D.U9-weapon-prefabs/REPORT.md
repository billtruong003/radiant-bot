# D.U9 — Weapon prefab catalog · REPORT

> Closed 2026-05-19 (Opus 4.7, sequential auto-run + Bill visual sign-off).
> Includes tune-up after first Bill visual review caught oversized-looking-tiny placeholders.

---

## Result: D.U9 PASS · Bill visual sign-off via slug cycle + drag-aim live test

`WeaponPrefabRegistry` static factory now maps the 6 catalog slugs (`weapon_thiet_con_01`, `weapon_chuy_01`, `weapon_kiem_01`, `weapon_thiet_phien_01`, `weapon_di_hoa_01`, `weapon_le_bang_01`) to composite primitive GameObjects parented to a "WeaponRoot" empty. Unknown slug → grey-sphere `_placeholder` + one-time warn log. Shapes tuned post-first-review so XZ footprints are 0.8-1.5u (vs capsule diameter 1.0u) — readable from top-down ortho cam (size 6) without clipping into capsule. `WeaponHueApplier.Apply(root, hex)` walks `GetComponentsInChildren<MeshRenderer>` and tints both `_BaseColor` (URP) + `_Color` (legacy) via shared MaterialPropertyBlock. `PlayerVisual.SyncFromContext` tracks `LockedWeapon.Slug`: on change, destroy previous `_weaponGo`, spawn new via Registry, position at `(0, 1.2, 0)` local (above capsule top, gap 0.7u), apply hue. Null snapshot path destroys held weapon.

### Mock-smoke chain (executed via Unity MCP)

```
─ Step A — Refresh + clean console ─────────────────────────────────────────────
refresh_unity force scope=all compile=request → ready_for_tools=true
read_console types=["error"] → 0 new errors after Assembly-CSharp recompile     ✓
(5 pre-existing baseline errors per D.U8 REPORT § Known baseline)

─ Step B — Bootstrap scene + Play ──────────────────────────────────────────────
manage_scene get_active → Bootstrap.unity buildIndex=0  ✓
manage_editor play → Entered play mode

─ Step C — Inject LockedWeapon both sides + SyncFromContext via reflection ─────
inject MyPlayer.LockedWeapon  = { Slug=weapon_kiem_01, Hue=#aaffaa }
inject OppPlayer.LockedWeapon = { Slug=weapon_chuy_01, Hue=#ffaa88 }
MyVisual childCount = 1  child = Weapon_weapon_kiem_01  localPos = (0, 1.20, 0)   ✓
                       renderers = 2 (blade + crossguard hilt)
                       MPB._BaseColor = (0.67, 1.00, 0.67) — exact #aaffaa parsed  ✓
OppVisual childCount = 1  child = Weapon_weapon_chuy_01  renderers = 2 (handle + sphere head)
                       MPB._BaseColor = (1.00, 0.67, 0.53) — exact #ffaa88 parsed  ✓

─ Step D — Catalog scan (clean-state fixture per iteration) ────────────────────
  thiet_con (staff)        renderers=1 (expected 1)  ✓
  chuy      (mace)         renderers=2 (expected 2)  ✓
  kiem      (sword)        renderers=2 (expected 2)  ✓
  thiet_phien (fan)        renderers=1 (expected 1)  ✓
  di_hoa    (flower)       renderers=3 (expected 3)  ✓
  le_bang   (icicles)      renderers=3 (expected 3)  ✓
  INVALID → placeholder    renderers=1 (expected 1)  ✓ + warn log fired once

─ Step E — Null LockedWeapon path ──────────────────────────────────────────────
spawn → set null → sync
  _currentWeaponSlug = "" ✓        _weaponGo = null ✓

─ Step F — Bill drag-aim live test (via ArenaDevMenu.MockToMyTurn) ─────────────
Bill exercised the full Lobby → Countdown → MyTurn flow via dev menu.
Console logs confirm drag-aim works end-to-end:
  [Arena.Aim] shot fired angle=-0.06 power=1.00
  [Arena.MyTurn] shot fired angle=-0.06 power=1.00
  [Arena.Net] Send(shoot) ignored — not connected.
  [Arena.Animating] Enter — awaiting shot_resolved
  [Bill.State] MyTurn -> Animating
Multiple shots fired (angle -0.06, -0.01, 0.01, -0.10). State transitions clean.
No trajectory rendering because no server (NetClient.Instance=null) — server
D.5 physics required for end-to-end shot resolution. NOT a D.U9 issue.

─ Step G — Visual sign-off via slug cycle (screenshots captured) ───────────────
Cycled MyVisual through all 6 catalog slugs + verified each silhouette:
  weapon_thiet_con_01  → horizontal white staff      ✓
  weapon_chuy_01       → handle + ball head          ✓
  weapon_kiem_01       → pink blade + crossguard     ✓
  weapon_thiet_phien_01 → flat green tablet          ✓
  weapon_di_hoa_01     → 3 cream spheres cluster     ✓
  weapon_le_bang_01    → 3 blue cylinders chevron    ✓
All shapes distinct enough for placeholder phase.

─ Step H — Stop Play + final console ──────────────────────────────────────────
manage_editor stop → Exited play mode
read_console types=["error"] → 0 new D.U9 errors (5 baseline only)              ✓
```

---

## Sub-by-sub status

| Sub | Status | Commit | Notes |
|---|---|---|---|
| Stage 1 docs | ✅ | `62cb881` | PLAN + SUBTASKS + OPUS_PROMPTS (~370 lines). |
| 1. Verify baseline | ✅ | — | Grep-based first pass; full MCP read_console after reconnect. |
| 2. WeaponPrefabRegistry | ✅ | `b7dfb4f` | 151 lines, 7 builders. |
| 3. WeaponHueApplier | ✅ | `ea7ab4b` | 39 lines, MPB hex tint. |
| 4. PlayerVisual extension | ✅ | `bbee50c` | +35/-4. WeaponOffsetY=0.8 (later tuned to 1.2). |
| 5a. First mock smoke (proves logic) | ✅ | — | 7/7 catalog renderer counts pass. |
| 5b. First visual sign-off attempt | ❌→tune | — | Bill caught oversized-looking-tiny: weapons invisible on top-down view at original scales (0.05-0.55u). |
| 5c. Tune scales + WeaponOffsetY | ✅ | `3c460d3` | All shapes 2-2.5x bigger (XZ footprint 0.8-1.5u), WeaponOffsetY 0.8 → 1.2. |
| 5d. Bill drag-aim live test | ✅ | — | ShotReleasedEvent fires correctly. State machine cycle clean. |
| 5e. Bill visual sign-off via slug cycle | ✅ | — | All 6 shapes verified distinct on green capsule (perspective view via dev menu scaffold). |

---

## Deviations from PLAN

1. **Sub 1 baseline grep-only on first half.** Unity MCP tools weren't loaded for the early session — fall-back to Grep on Assets/RadiantArena tree for baseline. All 4 PLAN §3 assumptions held. Bill reconnected MCP mid-session → full read_console + execute_code + manage_editor available for Sub 5.

2. **Risk #7 (PLAN §10) moot — Hue never empty in practice.** PLAN feared `WeaponSnapshot.Hue` empty string. Actual default in [ArenaContext.cs:186](Assets/RadiantArena/Scripts/Net/ArenaContext.cs#L186) is `"#ffffff"`. `WeaponHueApplier.Apply`'s `IsNullOrEmpty` guard kept as defensive — costs nothing.

3. **PLAN §6.4 SyncFromContext restructure.** Sub 4 had to lift the position update out of the early-return-on-fallback path so weapon block always runs after. PLAN §6.4 snippet implied direct append — actual edit refactored the `if (Mathf.Approximately(p.X, 0f) && p.Y == 0f) { ... return; }` into `if/else` to keep weapon attach reachable when capsule sits at SlotAnchor. No semantic change to position logic.

4. **Sub 5 catalog scan needed clean-state fixture.** First MCP smoke ran sequential slug-swaps via reflection-invoke under MCP-idle Time-stall — `UnityEngine.Object.Destroy` is end-of-frame-deferred, frames don't tick between sync calls → orphan weapon GameObjects accumulated, probes gave false negatives. Rewrote with (a) `DestroyImmediate` for orphan cleanup, (b) reflection-reset `_currentWeaponSlug = ""` + `_weaponGo = null` before each iteration. Production 100ms poll never hits this artifact — frame ticks <16ms < 100ms poll. Same lesson as D.U5/D.U7/D.U8 MCP-idle Time-stalls.

5. **Scale tune-up Sub 5c added (NOT in original PLAN).** First visual sign-off attempt with original PLAN-spec'd scales (0.04-0.55u extents) rendered as 1-pixel slivers under top-down ortho cam — invisible. Bill caught immediately ("đã có đủ weapons prefab chưa mà move vội?"). Tune-up commit `3c460d3` scaled all shapes 2-2.5x to XZ footprint 0.8-1.5u and bumped `WeaponOffsetY` 0.8 → 1.2 for better separation from capsule top. Hue test pattern also swapped from green/orange (which blended with capsule color) to neutral white/cyan/pink for verification screenshots. Documented as deviation; PLAN §6.8 placeholder design table should reference these new values.

6. **Premature folder move + revert.** I moved folder to `done/` after Step F mock smoke before Bill ran visual sign-off. Bill caught it — reverted closeout commit `aa51f5b` via `bafd33f`, kept folder in `todo/` until visual pass complete. Lesson recorded: move-to-done only after explicit visual sign-off, not after mock smoke alone.

---

## Bill checkpoints — what happened

| Checkpoint | Outcome |
|---|---|
| Sub 1 | Grep-only baseline + post-reconnect MCP read_console — 5/5 assumptions held. |
| Sub 2 | Auto-run. Composite primitives spawned correctly per slug. |
| Sub 3 | Auto-run. MPB pattern works (verified via reflection probe — exact hex parse match). |
| Sub 5a | Auto smoke — 7/7 renderer counts pass. |
| Sub 5b | **Bill caught oversized-looking-tiny** — visual fail. Reverted closeout, tuned scales. |
| Sub 5c | Auto tune commit. Atlas screenshot + per-slug capsule cycle verifies all 6 shapes. |
| Sub 5d | Bill drag-aim live test — drag fires `ShotReleasedEvent` end-to-end. Confirmed not-a-D.U9-bug for "shot doesn't render" (server D.5 missing). |
| Sub 5e | Bill visual sign-off via slug cycle complete. |

---

## What's left

### D.U9 itself
- None. Closed.

### Unblocked by D.U9 close
- **D.U7b anticipation pulse** — weapon scale 1.0→1.15 before shot release. Now attachable since `_weaponGo` lives under PlayerVisual transform.
- **Weapon facing aim direction** during drag-aim — future D.U10/D.U12 polish.
- **Real FBX/texture asset pass** — swap Registry switch-case bodies for `WeaponDatabase` ScriptableObject lookup when artist drops assets.

### Roadmap

| # | Lát | Folder | Status |
|---|---|---|---|
| 9 | D.U9 — Weapon prefab catalog | `tasks/done/D.U9-weapon-prefabs/` (after closeout) | ✅ |
| 10 | D.U10 — UI fantasy polish | `tasks/todo/D.U10-ui-polish/` | ⬜ Stage 1 needed |
| 11 | D.U11 — HLSL shaders | `tasks/todo/D.U11-shaders/` | ⬜ |
| 12 | D.U12 — WebGL deploy LAST | `tasks/todo/D.U12-webgl-deploy/` | ⬜ |

### Combat E2E (out of D.U9 scope, blocked elsewhere)
- ⏸ Server Lát D.5 physics — real shot trajectory + HP drops for end-to-end combat smoke.
- ⏸ Server Lát D.7 skills engine — skill effects on shot resolution.
- ⏸ ParrelSync 2-Editor PvP test — needs server above. Bill's `ArenaPK_clone_0` instance is ready; just needs `ws://localhost:2567` reachable.

---

## Files added/edited

| Path | Lines | Status |
|---|---|---|
| `Assets/RadiantArena/Scripts/Weapons/WeaponPrefabRegistry.cs` | 162 | new + tuned |
| `Assets/RadiantArena/Scripts/Weapons/WeaponHueApplier.cs` | 39 | new |
| `Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs` | +35 / -4 | edit (extended with weapon attachment + tuned WeaponOffsetY) |

---

## Commits (this Lát, post-Stage 1)

```
3c460d3 feat(arena-unity/Lát-D.U9): tune weapon scales 2-2.5x + raise WeaponOffsetY → 1.2 for top-down visibility
bafd33f Revert "chore(arena-unity/Lát-D.U9): mark complete, move to done — REPORT.md added"
aa51f5b chore(arena-unity/Lát-D.U9): mark complete, move to done — REPORT.md added  (premature, reverted)
bbee50c feat(arena-unity/Lát-D.U9): PlayerVisual spawns weapon via WeaponPrefabRegistry on LockedWeapon.Slug change + applies hue
ea7ab4b feat(arena-unity/Lát-D.U9): add WeaponHueApplier — MaterialPropertyBlock hex tint across weapon hierarchy
b7dfb4f feat(arena-unity/Lát-D.U9): add WeaponPrefabRegistry — runtime composite primitive factory (6 catalog + placeholder)
62cb881 docs(arena-unity/Lát-D.U9): Stage 1 architect — PLAN + SUBTASKS + OPUS_PROMPTS
```

(Plus the closeout chore commit moving this folder to `done/` — appears in git log after this REPORT.md is written.)

---

## Next lát: D.U10 — UI fantasy polish

Prereqs unblocked by D.U9:
- Capsules + weapons render in arena — UI HUD overlay can reference player + weapon identity for tier color coding.
- WeaponSnapshot.Tier + Hue available to UI panels.

Stage 1 architect (Opus) writes PLAN + SUBTASKS for D.U10 — calligraphic font, ink overlay, tier color coding (Phẩm/Địa/Thiên/Tiên/Bản mệnh), dramatic damage numbers. Folder currently empty at `arena-unity/tasks/todo/D.U10-ui-polish/`.
