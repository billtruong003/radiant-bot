# D.U9b — Weapon + Map polish · OPUS_PROMPTS

> Opus sequential auto-run. Each sub = 1 invoke (memory [[sonnet-one-sub-invocation]]).

---

## Sub 1 — Verify baseline (NO commit)

```
Persona: arena-unity/SKILL.md. Lát D.U9b Stage 2 Sub 1.

## Read
- arena-unity/tasks/todo/D.U9b-weapon-map-polish/PLAN.md §3, §10
- SUBTASKS.md Sub 1

## Do
1. read_console types=["error"] → baseline (expect 5 D.U8 known-baseline entries).
2. Grep "BillTween.Float" Assets/RadiantArena → record signature (does it take completion callback or chain via Bill.Time.Delay?).
3. Grep "PrefabUtility.SaveAsPrefabAsset" Library/PackageCache → confirm Unity 6 API namespace + signature.
4. Glob "Assets/RadiantArena/Resources/**" → expect 0 (folder absent).
5. Read CameraShaker.cs L40-50 — observe BillTween pattern.
6. Read MyTurnState.cs L60-65 — confirm OnShotReleased exact shape.

## Output
- Baseline OK ✅
- BillTween.Float signature: <record>
- PrefabUtility API confirmed ✅
- Resources/ folder absent ✅ (will be created Sub 2)
- BillTween pattern observed ✅
- OnShotReleased insertion site clear ✅

## STOP — no commit.
```

---

## Sub 2 — Generator + 7 .prefab assets

```
Persona: SKILL.md. Lát D.U9b Sub 2.

## Read
- SUBTASKS.md Sub 2 (full code skeleton + run instructions)
- PLAN.md §6.1, §6.2 (Resources/ path + builder method visibility)

## Do
1. Edit Assets/RadiantArena/Scripts/Weapons/WeaponPrefabRegistry.cs:
   - Extract switch dispatch into `internal static GameObject CreateUnparented(string slug)` returning runtime composite GO WITHOUT SetParent + WITHOUT name assignment.
   - Keep existing Spawn signature for now (Sub 3 will migrate it).
   - Builder methods stay as-is.
   - `_placeholder` slug must hit BuildPlaceholder.
2. Write Assets/RadiantArena/Editor/ArenaWeaponPrefabGenerator.cs verbatim from SUBTASKS Sub 2.2.
3. refresh_unity force scope=all → wait ready. read_console types=["error"] → 0 new.
4. execute_menu_item "Tools/RadiantArena/Generate Weapon Prefabs" via MCP.
5. refresh_unity if_dirty. read_console → expect log "[WeaponPrefabGen] Generated 7 prefab(s) at Assets/RadiantArena/Resources/Weapons".
6. manage_asset action=search filterType=Prefab path filter "Resources/Weapons" → 7 entries.

## Commit
feat(arena-unity/Lát-D.U9b): add ArenaWeaponPrefabGenerator + 7 weapon .prefab assets — fix D.U9 misnomer

## STOP after commit.
```

---

## Sub 3 — WeaponPrefabRegistry migration

```
Persona: SKILL.md. Lát D.U9b Sub 3.

## Read
- SUBTASKS.md Sub 3 (full code)
- PLAN.md §6.3 (cache pattern)

## Do
- Edit WeaponPrefabRegistry.Spawn → Resources.Load + Instantiate path per SUBTASKS Sub 3.
- Add static prefab cache Dictionary.
- Keep CreateUnparented internal (Generator still needs it for regeneration use case).
- Keep EnsureBaseMaterial + builder methods (called only by CreateUnparented).
- Keep WarnUnknown for missing prefab fallback path.
- refresh_unity → read_console → 0 new.

## Commit
feat(arena-unity/Lát-D.U9b): migrate WeaponPrefabRegistry.Spawn — Resources.Load + cache (was switch-case factory)

## STOP after commit.
```

---

## Sub 4 — PlayerVisual position + aim-facing rotation

```
Persona: SKILL.md. Lát D.U9b Sub 4.

## Read
- SUBTASKS.md Sub 4 (full code)
- PLAN.md §6.4, §6.5 (offset + rotation logic)
- Memory: [[bill-ondestroy-guard]] — OnDisable unsubscribe with Bill.IsReady guard.

## Do
- Edit PlayerVisual.cs per SUBTASKS:
  - Replace WeaponOffsetY const with WeaponOffset Vector3.
  - Add public GameObject? WeaponGo getter.
  - Add _latestAimAngleRad field + OnEnable/OnDisable AimUpdatedEvent sub/unsub.
  - Update SyncFromContext to use WeaponOffset for localPosition.
  - Add LateUpdate with rotation logic (IsMine→aim angle, opp→LookAt MyVisual).
- refresh_unity → read_console → 0 new.

## Commit
feat(arena-unity/Lát-D.U9b): PlayerVisual lateral weapon offset + aim-facing rotation (mine→AimUpdated, opp→LookAt me)

## STOP after commit.
```

---

## Sub 5 — JuicePresenter.PlayAnticipation + MyTurnState integration

```
Persona: SKILL.md. Lát D.U9b Sub 5.

## Read
- SUBTASKS.md Sub 5.1, 5.2 (full code)
- PLAN.md §6.6 (timing + null-guard semantics)
- Sub 1 output for BillTween.Float signature confirmation — adapt code if no completion callback.

## Do
- Edit JuicePresenter.cs: add AnticipationDurSec + AnticipationScale const + PlayAnticipation static method + StartAnticipationCoroutine instance method.
- Edit MyTurnState.OnShotReleased: defer Send + GoTo via JuicePresenter.PlayAnticipation.
- Handle case `BillTween.Float` has no completion cb — fallback chain via `Bill.Time.Delay(half, ...)` or `StartCoroutine(WaitThenScaleBack(...))`. Pick the cleanest available pattern.
- refresh_unity → read_console → 0 new.

## Commit
feat(arena-unity/Lát-D.U9b): add JuicePresenter.PlayAnticipation + MyTurnState defers shot 80ms with weapon pulse

## STOP after commit.
```

---

## Sub 6 — ArenaSceneBuilder map polish

```
Persona: SKILL.md. Lát D.U9b Sub 6.

## Read
- SUBTASKS.md Sub 6 (full code)
- PLAN.md §6.7 (lighting choice + wall trim layout)
- Existing ArenaSceneBuilder.cs to find:
  - wall spawn block (extract wallTopY constant)
  - the proper `Awake` ordering — lighting should come AFTER ground/walls but BEFORE capsules so shadows work.

## Do
- Edit ArenaSceneBuilder.cs:
  - Add ArenaKeyLight (Directional, soft shadows, key warm color).
  - Set RenderSettings.ambientLight cool tint.
  - Add 4 wall trim caps (top/bottom/left/right) — use wallTopY from existing wall config.
  - SKIP corner pillars unless visual feels heavy in screenshot — defer.
- refresh_unity → read_console → 0 new.

## Commit
feat(arena-unity/Lát-D.U9b): ArenaSceneBuilder map polish — Directional Light + ambient + wall trim caps

## STOP after commit.
```

---

## Sub 7 — Mock smoke + Bill visual sign-off (NO commit)

```
Persona: SKILL.md. Lát D.U9b Sub 7.

## Read
- SUBTASKS.md Sub 7 (smoke protocol)
- arena-unity/tasks/done/D.U9-weapon-prefabs/REPORT.md §Mock-smoke chain — pattern reference.

## Do
1. read_console clear. refresh_unity force scope=all wait_for_ready=true.
2. manage_asset search filterType=Prefab "Resources/Weapons" → 7 entries.
3. manage_editor play.
4. execute_code compiler=codedom: ArenaStates.Register, MyDiscordId, snapshots, LockedWeapon kiem_01, GoTo MyTurnState, force SyncFromContext.
5. Reflection probe:
   - WeaponGo != null
   - localPosition = (0.55, 0.50, 0)
   - name = Weapon_weapon_kiem_01
6. Fire AimUpdatedEvent { angle = Mathf.PI/4 }. Wait 1 frame (use LateUpdate's tick by yielding via SceneView.RepaintAll or 16ms sleep). Probe WeaponGo.localRotation.eulerAngles.y ≈ ±45.
7. Fire ShotReleasedEvent { angle, power=1.0 }. Within 0.2s, state transitions to AnimatingState.
8. Optional: manage_camera screenshot include_image=true (top-down + scene_view oblique) for Bill visual cross-check.
9. Stop Play. read_console types=["error"] → 0 new D.U9b errors.

## Bill visual sign-off
Bootstrap → Play → ArenaDevMenu > Mock to MyTurn → drag → release → pulse → atmosphere check.

If Bill green-lights:
- Write REPORT.md (mirror D.U9 REPORT structure).
- git mv todo/D.U9b-weapon-map-polish → done/.
- Commit: chore(arena-unity/Lát-D.U9b): mark complete after Bill visual sign-off, move to done — REPORT.md added

DO NOT MOVE FOLDER BEFORE EXPLICIT BILL VISUAL SIGN-OFF. Lesson from D.U9 premature move (commit aa51f5b reverted via bafd33f).

## STOP — no commit until Bill confirms visual.
```

---

## Notes for Sonnet executor

- Each sub is a single MCP-driven invocation. Do NOT chain into the next sub.
- MCP-idle Time-stall lesson (D.U5/D.U7/D.U8/D.U9 REPORTs): manual reflection-invoke of private methods works around Update-loop not ticking between MCP calls. Use this pattern for verify steps.
- ParrelSync clone may be running (`ArenaPK_clone_0`). MCP routes to original `ArenaPK@1e0e2080247dd973` by default. If state slips unexpectedly, check `mcpforunity://instances` to confirm routing.
- Visual sign-off via screenshot first, then optional Bill manual play. Be honest if visuals look "off" — Bill expects callouts, not silent passing.
