# D.U8 — Arena scene · OPUS_PROMPTS

> Opus sequential auto-run (D.U4-D.U7 precedent).

---

## Sub 1 — Verify baseline (NO commit)

```
Persona: SKILL.md. Lát D.U8 Stage 2 Sub 1.

## Read
- arena-unity/tasks/todo/D.U8-arena-scene/PLAN.md §3, §6
- arena-unity/tasks/todo/D.U8-arena-scene/SUBTASKS.md Sub 1

## Do
1. read_console types=["error"] → baseline.
2. Glob Assets/RadiantArena/Scenes/Bootstrap.unity present.
3. Grep "Main Camera" Bootstrap.unity → confirm exists.
4. Grep "SetOrigin\\(" Assets/RadiantArena → confirm ArenaAimController.SetOrigin callable + 0 callers today.
5. Grep "EditorBuildSettings" Assets → expect no prior fixer.

## Output
- Report baseline status to Bill.

## STOP — no commit.
```

---

## Sub 2 — ArenaSceneBuilder

```
Persona: SKILL.md. Lát D.U8 Sub 2.

## Read
- SUBTASKS.md Sub 2 (full code)
- PLAN.md §6.1, §6.2, §6.3, §6.5 (camera config, runtime spawn, singleton pattern, material tints)

## Do
- Create Assets/RadiantArena/Scripts/Arena/ArenaSceneBuilder.cs verbatim per SUBTASKS Sub 2.
- Singleton MonoBehaviour, DDOL.
- Awake: BuildMaterials → ConfigureCamera (ortho top-down (0,10,0), Euler(90,0,0), size 6, clear SolidColor BgColor) → BuildGround (Plane scale 1 = 10×10) → BuildWalls (4 Cubes at borders, colliders dropped) → BuildPlayers (2 Capsules at slot anchors, colliders dropped, PlayerVisual attached).
- refresh_unity scope=all mode=force; read_console zero new errors.

## Commit
feat(arena-unity/Lát-D.U8): add ArenaSceneBuilder — top-down ortho camera + runtime ground + walls + player capsules

## STOP
```

---

## Sub 3 — PlayerVisual

```
Persona: SKILL.md. Lát D.U8 Sub 3.

## Read
- SUBTASKS.md Sub 3 (full code)
- PLAN.md §6.4 (fallback heuristic for server-uninitialized X=Y=0)

## Do
- Create Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs verbatim.
- MonoBehaviour with IsMine bool + SlotAnchor Vector3.
- Update polls every 100ms (Time.unscaledDeltaTime accumulator).
- SyncFromContext: read ArenaContext.MyPlayer or OpponentPlayer based on IsMine; if null OR (X≈0 && Y≈0) → SlotAnchor; else WorldFromSim(X, Y) + keep capsule Y.
- refresh_unity scope=scripts; read_console zero new errors.

## Commit
feat(arena-unity/Lát-D.U8): add PlayerVisual — polls ArenaContext per 100ms, falls back to SlotAnchor when server uninitialized

## STOP
```

---

## Sub 4 — Wire ArenaSceneBuilder spawn

```
Persona: SKILL.md. Lát D.U8 Sub 4.

## Read
- SUBTASKS.md Sub 4

## Do
- Edit Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs:
  - After the existing JuicePresenter spawn block (D.U7), add the parallel ArenaSceneBuilder spawn (guarded by Instance == null).
- refresh_unity scope=scripts; read_console zero new errors.

## Commit
feat(arena-unity/Lát-D.U8): spawn ArenaSceneBuilder from ArenaBootstrap.InitArena

## STOP
```

---

## Sub 5 — MyTurnState aim origin wiring

```
Persona: SKILL.md. Lát D.U8 Sub 5.

## Read
- SUBTASKS.md Sub 5
- Assets/RadiantArena/Scripts/States/MyTurnState.cs existing Enter

## Do
- Edit MyTurnState.Enter: right after `_aim = go.AddComponent<ArenaAimController>();`, insert:
    _aim.SetOrigin(RadiantArena.Arena.ArenaSceneBuilder.Instance?.MyVisual?.transform);
- refresh_unity scope=scripts; read_console zero new errors.

## Commit
feat(arena-unity/Lát-D.U8): MyTurnState passes MyVisual.transform as ArenaAimController origin — drag-aim line tracks my-player position

## STOP
```

---

## Sub 6 — ArenaBuildSettingsFixer (Editor menu)

```
Persona: SKILL.md. Lát D.U8 Sub 6.

## Read
- SUBTASKS.md Sub 6 (full code)
- PLAN.md §6.8

## Do
- Create Assets/RadiantArena/Editor/ArenaBuildSettingsFixer.cs verbatim.
- #if UNITY_EDITOR guard + namespace RadiantArena.EditorTools.
- MenuItem "Tools/RadiantArena/Set Bootstrap as Scene 0".
- SetBootstrapScene0(): load SceneAsset at "Assets/RadiantArena/Scenes/Bootstrap.unity"; build EditorBuildSettingsScene[] with Bootstrap first, preserve others (skip duplicates); assign EditorBuildSettings.scenes.
- refresh_unity scope=all mode=force; read_console zero new errors.

## Commit
feat(arena-unity/Lát-D.U8): add ArenaBuildSettingsFixer editor menu — set Bootstrap.unity as Scene 0

## STOP
```

---

## Sub 7 — Mock smoke + Bill visual check (NO commit)

```
Persona: SKILL.md. Lát D.U8 Sub 7.

## Pre
- Bill loads Bootstrap.unity manually OR run RadiantArena.EditorTools.ArenaBuildSettingsFixer.SetBootstrapScene0() via execute_code first.
- manage_editor stop then play.
- compiler=codedom.

## Do
1. read_console clear.
2. execute_code (codedom): call ArenaBuildSettingsFixer.SetBootstrapScene0() (idempotent — safe even if already set).
3. Probe Camera.main: orthographic / size / position / rotation.
4. find_gameobjects "ArenaGround" → count 1.
5. find_gameobjects "Wall*" — expect 4 (WallNorth/South/East/West).
6. find_gameobjects "MyPlayerVisual" → 1; "OpponentPlayerVisual" → 1.
7. Probe ArenaSceneBuilder.Instance.MyVisual / OpponentVisual non-null.
8. Probe initial capsule positions (slot fallback): me=(-3, 0.5, 0), opp=(3, 0.5, 0).
9. Inject ArenaContext.MyPlayer with X=200, Y=500. Sleep 0.2s. Probe my-capsule position → (-3, 0.5, 0) (WorldFromSim(200,500)=(-3, 0, 0); capsule Y stays 0.5).
10. Drive into MyTurnState (register states, prime ctx, GoTo<CountdownState>, fire PhaseChangedEvent newPhase=active).
11. Probe ArenaAimController._origin via reflection → equals MyVisual.transform (not null, not Vector3.zero).
12. manage_editor stop. read_console types=["error"] → 0.

## Bill manual visual
- Verify Build Settings fixer applied; reopen Bootstrap.unity as Play scene.
- Focus Game View, see arena top-down + 2 capsules + ground + walls.
- If MyTurn entered via mock, drag mouse → green aim line emits from me-capsule (not origin).
- Sign-off D.U8 close.

## Output
- Pass/fail per probe.

## STOP — no commit. Stage 4 REPORT follows.

## Fallback
- If Build Settings fixer can't run from execute_code (UnityEditor namespace access from runtime context errors) — invoke the menu manually via mcp__unityMCP__execute_menu_item "Tools/RadiantArena/Set Bootstrap as Scene 0".
- If Bootstrap.unity not loaded and SampleScene active (no ArenaBootstrap GO) — fallback: spawn ArenaSceneBuilder manually in mock as we did for JuicePresenter in D.U7.
```

---

## Bill checkpoints

| After | Action |
|---|---|
| Sub 1 | Confirm baseline assumptions. |
| Sub 2 | Optional camera tunable review (ortho size, Y height). |
| Sub 6 | Bill runs menu once + confirms Build Settings updated. |
| Sub 7 | Visual sign-off — Bill sees arena, capsules, drag-aim from me-capsule. Closes D.U8. |

## Notes
- Roadmap shift applied pre-Sub-1: D.U9 = weapon prefabs (was D.U8), D.U10 = UI fantasy polish (new), D.U11 = HLSL shaders (was D.U9), D.U12 = WebGL deploy LAST (was D.U10). ROADMAP.md + TASKS.md committed before Sub 1.
- Pre-commit hook fail → NEW commit per global rule.
