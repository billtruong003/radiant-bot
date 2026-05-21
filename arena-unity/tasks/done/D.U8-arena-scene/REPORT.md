# D.U8 — Arena scene · REPORT

> Closed 2026-05-18 (Opus 4.7, sequential auto-run).

---

## Result: D.U8 PASS pending Bill visual sign-off

Top-down orthographic arena scene runtime-builds at boot via `ArenaSceneBuilder` singleton (spawned by `ArenaBootstrap.InitArena` alongside D.U7's JuicePresenter). Ground Plane + 4 wall Cubes + 2 player Capsules + camera reconfig — all in code, zero scene-file diff. `PlayerVisual` MonoBehaviour polls `ArenaContext.MyPlayer/OpponentPlayer.X/Y` every 100ms and maps via `TrajectoryConstants.WorldFromSim` (sim 0..1000 → world ±5), with SlotAnchor fallback when server hasn't set position (x≈y≈0 heuristic — covers today's case where server D.5 physics not yet shipped). Drag-aim line now originates from my-player capsule (D.U4 `ArenaAimController.SetOrigin` wired in `MyTurnState.Enter`). `ArenaBuildSettingsFixer` editor menu fixes `Bootstrap.unity` as Scene 0 — Bill ran into the SampleScene-loaded-by-default issue during D.U7 visual test, this prevents recurrence.

### Mock-smoke chain

```
─ Step A — Builder spawn + camera config ──────────────────────────────────────
(SampleScene loaded by default, ArenaBootstrap.InitArena didn't fire —
fallback path executed manually, mirroring future Bootstrap.unity load.)
[Arena.Scene] ArenaSceneBuilder ready — ground, 4 walls, 2 capsules, top-down ortho camera
camera: ortho=True size=6.0 posY=10.0 eulerX=90.0   ✓

─ Step B — Scene presence probe ───────────────────────────────────────────────
builder.MyVisual.position       = (-3.00, 0.50, 0.00)   ✓ slot anchor me
builder.OpponentVisual.position = ( 3.00, 0.50, 0.00)   ✓ slot anchor opp
walls (FindObjectsOfTypeAll, name starts "Wall") = 4    ✓

─ Step C — Position binding probe ─────────────────────────────────────────────
inject MyPlayer { X=700, Y=300 } (expected WorldFromSim → (2, 0, -2))
manual SyncFromContext invoke → myVisual=(2.00, 0.50, -2.00)   ✓
(Update poll didn't fire — Time stalls during MCP-idle, D.U5 lesson.
 Manual method invoke proves logic; production Play ticks normally.)

─ Step D — MyTurnState aim origin wiring ──────────────────────────────────────
Bill.State.GoTo<MyTurnState>()
[Arena.Aim] ArenaAimController ready
aimController._origin (reflection probe):
  set:               True
  equals MyVisual:   True
  Transform.name:    MyPlayerVisual                                ✓
```

Final `read_console types=["error"]` after Play stop: **0 entries**. Zero new errors introduced.

### Bill manual visual sign-off (post-execute)

Pending Bill action — same flow as D.U7 manual feel-check:

1. **Apply Build Settings fix** — `Tools > RadiantArena > Set Bootstrap as Scene 0` (or call `RadiantArena.EditorTools.ArenaBuildSettingsFixer.SetBootstrapScene0()` via dev menu).
2. Open `Assets/RadiantArena/Scenes/Bootstrap.unity` as active scene.
3. Press Play. Focus Game View.
4. Expected visual: dark-slate ground, slightly-lighter walls outlining the 10×10 arena, green capsule at left-of-center, orange capsule at right-of-center, HUD overlay (D.U6 bars + timer) on top.
5. (Optional) Drive into MyTurn via execute_code paste from D.U7 auto-fire recipe — drag mouse → green aim line emits from green capsule (not world origin).
6. Sign-off D.U8 close. Stop Play.

---

## Sub-by-sub status

| Sub | Status | Commit | Notes |
|---|---|---|---|
| Stage 1 docs | ✅ | `60b1c43` | PLAN + SUBTASKS + OPUS_PROMPTS. |
| Roadmap restructure (Bill order rule — deploy LAST) | ✅ | `6d0c280` | ROADMAP.md + TASKS.md + folder rotation: D.U9 weapon prefabs, D.U10 UI polish, D.U11 shaders, D.U12 deploy LAST. |
| 1. Verify baseline | ✅ | — | Console clean, `SetOrigin` callable + 0 callers, no prior `EditorBuildSettings` consumer, Bootstrap.unity at expected path. |
| 2 + 3. ArenaSceneBuilder + PlayerVisual | ✅ | `2e95333` | Bundled commit (mutual type dependency). Camera config + 7 GO spawn (ground + 4 walls + 2 capsules) + PlayerVisual binding loop. |
| 4. Wire spawn from ArenaBootstrap | ✅ | `4a05ca3` | Insert ArenaSceneBuilder spawn between JuicePresenter spawn (D.U7) and `Bill.State.GoTo<BootState>()`. |
| 5. MyTurnState aim origin | ✅ | `337ced4` | One-liner — `_aim.SetOrigin(ArenaSceneBuilder.Instance?.MyVisual?.transform)`. |
| 6. ArenaBuildSettingsFixer (Editor menu) | ✅ | `cfe639b` | `Tools > RadiantArena > Set Bootstrap as Scene 0`, idempotent (preserves other scenes). |
| 7. Mock smoke | ✅ | — | All 4 probe steps pass. Bill visual sign-off pending. |

---

## Deviations from PLAN

1. **Sub 2 + Sub 3 commits bundled.** PLAN/SUBTASKS spec'd 6 commits (one per Sub 2/3); shipped 5. Reason: `ArenaSceneBuilder.BuildPlayer` returns `PlayerVisual` — committing Sub 2 alone would have left an intermediate non-compilable state in git history. Bundled commit keeps every hash compilable.

2. **PLAN.md §6.4 fallback heuristic edge case validated — caught by smoke.**
   First Sub 7 position probe used `MyPlayer.X=200, Y=500` to test live binding. WorldFromSim(200, 500) = (-3, 0, 0) — coincidentally equal to me-slot anchor `(-3, 0.5, 0)`. Probe couldn't distinguish "fallback fired" vs "live binding fired". Retested with `X=700, Y=300` → expected world `(2, 0, -2)`. Manual SyncFromContext invoke confirmed live binding writes the correct position. PLAN §6.4 edge case ("server places player at sim center 500,500 → world origin → mis-fires fallback") is real but harmless for D.U8 placeholder; will revisit when server D.5 ships authoritative positions.

3. **Time-stall (D.U5 lesson) prevents direct verification of Update-loop ticking.**
   PlayerVisual's 100ms poll relies on `Time.unscaledDeltaTime`. Same as D.U5/D.U7 mock smoke, the Editor stalls Time when MCP is idle — the poll never fired between MCP calls. Workaround: reflection-invoke the private `SyncFromContext` method directly to confirm the logic. Bill manual play (focused Game View) will tick Time normally. Documented in §Mock-smoke Step C.

4. **Sub 7 step-by-step probe order swapped vs PLAN.**
   PLAN listed: camera → find_gameobjects → init position → inject ctx → drive MyTurn → aim probe. Actual order: same, but `find_gameobjects` for "ArenaGround"/"MyPlayerVisual" returned 0 (probably DDOL hierarchy quirk — GOs are children of DontDestroyOnLoad scene). Fallback: reflection probe on `ArenaSceneBuilder.Instance` properties + `Resources.FindObjectsOfTypeAll<GameObject>` scan. Authoritative.

5. **`ArenaBuildSettingsFixer.SetBootstrapScene0()` callable from execute_code via UnityEditor namespace access.**
   PLAN §6.8 + Sub 6 documented as "Editor-only menu". Smoke tested calling it from execute_code — works (execute_code runs in Editor context, has UnityEditor access). Future smokes can pre-apply the fix without manual menu click.

6. **ArenaBootstrap.InitArena race vs MCP execute_code STILL not resolved by the fixer.**
   The fixer ensures Bootstrap.unity loads on *next* Play. Today's Play session loaded SampleScene because the fixer hadn't been applied yet — chicken-and-egg. Bill applies the fixer once (via menu), then *next* Play loads Bootstrap.unity correctly. Documented in REPORT manual sign-off.

---

## Bill checkpoints — what happened

| Checkpoint | Outcome |
|---|---|
| Sub 1 | Auto baseline pass — 3 assumptions held, no live execute_code probe needed for `Camera.main` (well-known). |
| Sub 2 | Auto-run; camera tunable constants visible in commit `2e95333` if Bill wants to revisit. |
| Sub 6 | Fixer landed. Bill runs menu post-Lát. |
| Sub 7 | Mock smoke green. Pending Bill visual sign-off. |

---

## What's left

### D.U8 itself
- Bill applies fixer menu + loads Bootstrap.unity + Play + visual sign-off. Stop Play.
- If visual feels wrong (camera too zoomed / too narrow / colors clash / slot positions off), adjust constants in `ArenaSceneBuilder.cs` lines 19-26 + commit a tune-up.

### Roadmap (committed pre-Sub-1 per Bill order rule)

| # | Lát | Folder | Status |
|---|---|---|---|
| 8 | D.U8 — Arena scene | `tasks/done/D.U8-arena-scene/` (after this) | 🟡 → ✅ |
| 9 | D.U9 — Weapon prefab catalog | `tasks/todo/D.U9-weapon-prefabs/` | ⬜ |
| 10 | D.U10 — UI fantasy polish | `tasks/todo/D.U10-ui-polish/` | ⬜ |
| 11 | D.U11 — HLSL shaders | `tasks/todo/D.U11-shaders/` | ⬜ |
| 12 | D.U12 — WebGL deploy LAST | `tasks/todo/D.U12-webgl-deploy/` | ⬜ |
| 13* | D.U13 — Replay viewer (optional) | not yet created | ⬜ |
| 14* | D.U14 — PvE mode (optional) | not yet created | ⬜ |

---

## Known baseline (NOT D.U8 issues)

- `Missing types referenced from component UniversalRenderPipelineGlobalSettings` — D.U1 URP downgrade leftover.
- `Cannot add menu item 'Tools/BillInspector/Validation Window'` — pre-existing dup from ArenaDevMenu untracked file.

---

## Files added/edited

| Path | Lines | Status |
|---|---|---|
| `Assets/RadiantArena/Scripts/Arena/ArenaSceneBuilder.cs` | 135 | new |
| `Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs` | 49 | new |
| `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs` | +7 | edit (spawn ArenaSceneBuilder) |
| `Assets/RadiantArena/Scripts/States/MyTurnState.cs` | +1 | edit (aim origin = MyVisual.transform) |
| `Assets/RadiantArena/Editor/ArenaBuildSettingsFixer.cs` | 47 | new |
| `arena-unity/ROADMAP.md` | +/-many | edit (priority order rewrite per Bill 2026-05-18 deploy-LAST rule) |
| `arena-unity/TASKS.md` | +/-many | edit (sections reordered D.U8 arena → D.U9 weapons → D.U10 UI polish → D.U11 shaders → D.U12 deploy LAST + D.U13/14 optional) |
| (folder rotation) | — | `D.U9-shaders` → `D.U11-shaders`, `D.U10-webgl-deploy` → `D.U12-webgl-deploy`, new `D.U9-weapon-prefabs/` + `D.U10-ui-polish/` |
| (meta sidecars) | — | auto-generated |

Stage 1 docs: ~880 lines under `arena-unity/tasks/todo/D.U8-arena-scene/`.

---

## Commits (this Lát)

```
cfe639b feat(arena-unity/Lát-D.U8): add ArenaBuildSettingsFixer editor menu — set Bootstrap.unity as Scene 0
337ced4 feat(arena-unity/Lát-D.U8): MyTurnState passes MyVisual.transform as ArenaAimController origin — drag-aim line tracks my-player position
4a05ca3 feat(arena-unity/Lát-D.U8): spawn ArenaSceneBuilder from ArenaBootstrap.InitArena
2e95333 feat(arena-unity/Lát-D.U8): add ArenaSceneBuilder + PlayerVisual — top-down ortho camera, runtime ground/walls/capsules, ArenaContext-driven position binding
6d0c280 docs(arena-unity): restructure phase order — deploy moved to D.U12 LAST
60b1c43 docs(arena-unity/Lát-D.U8): Stage 1 architect — PLAN + SUBTASKS + OPUS_PROMPTS
```

---

## Next lát: D.U9 — Weapon prefab catalog

Prereqs unblocked by D.U8:
- `PlayerVisual` capsules exist as parent transforms — weapon prefabs can attach via `transform.SetParent(playerVisual.transform)`.
- Camera + map established — weapons render in correct world coords.
- D.U7 anticipation pulse (D.U7b deferred) gets unblocked once a weapon prefab is attachable.

Prereqs STILL blocked:
- ⏸ Server Lát D.5 physics for real combat smoke (HP drops, match end via HP=0).
