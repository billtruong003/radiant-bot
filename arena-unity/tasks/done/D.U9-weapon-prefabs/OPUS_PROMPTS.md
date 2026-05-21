# D.U9 — Weapon prefab catalog · OPUS_PROMPTS

> Opus sequential auto-run.

---

## Sub 1 — Verify baseline (NO commit)

```
Persona: arena-unity/SKILL.md. Lát D.U9 Stage 2 Sub 1.

## Read
- arena-unity/tasks/todo/D.U9-weapon-prefabs/PLAN.md §3, §6
- SUBTASKS.md Sub 1

## Do
1. read_console types=["error"] → baseline.
2. Grep "_BaseColor" Library/PackageCache (or Unlit shader files) → confirm URP property name.
3. Grep "WeaponSnapshot" Assets/RadiantArena → confirm Slug + Hue public fields.
4. Grep "GetPropertyBlock" Assets/RadiantArena → confirm no prior MPB consumer.

## Output
- Baseline OK
- URP property name confirmed (default `_BaseColor`, fallback `_Color`)
- WeaponSnapshot fields accessible ✅
- 0 prior MPB consumers ✅

## STOP — no commit.
```

---

## Sub 2 — WeaponPrefabRegistry

```
Persona: SKILL.md. Lát D.U9 Sub 2.

## Read
- SUBTASKS.md Sub 2 (full code)
- PLAN.md §6.1, §6.8 (no .prefab assets, composite shape recipes)

## Do
- Create Assets/RadiantArena/Scripts/Weapons/WeaponPrefabRegistry.cs verbatim per SUBTASKS.
- Static class with Spawn(slug, parent) → GameObject.
- 7 builder methods: BuildThietCon / BuildChuy / BuildKiem / BuildThietPhien / BuildDiHoa / BuildLeBang / BuildPlaceholder.
- Each builds composite primitives (1-3 per weapon), parents to "WeaponRoot" empty GO, drops colliders, shares a single URP/Unlit base material.
- Unknown slug → placeholder + one-time warn log per slug.
- refresh_unity scope=all mode=force; read_console zero new.

## Commit
feat(arena-unity/Lát-D.U9): add WeaponPrefabRegistry — runtime composite primitive factory (6 catalog + placeholder)

## STOP
```

---

## Sub 3 — WeaponHueApplier

```
Persona: SKILL.md. Lát D.U9 Sub 3.

## Read
- SUBTASKS.md Sub 3 (full code)
- PLAN.md §6.3 (MPB pattern + URP property name)

## Do
- Create Assets/RadiantArena/Scripts/Weapons/WeaponHueApplier.cs verbatim.
- Static Apply(GameObject root, string hex). Parse via ColorUtility.TryParseHtmlString (prepend "#" if missing). Walk GetComponentsInChildren<MeshRenderer>(includeInactive=true). Set MPB with both `_BaseColor` (URP) + `_Color` (legacy) → SetPropertyBlock per renderer.
- Empty/invalid hex → log warning + no-op (default white preserved).
- refresh_unity scope=scripts; read_console zero new.

## Commit
feat(arena-unity/Lát-D.U9): add WeaponHueApplier — MaterialPropertyBlock hex tint across weapon hierarchy

## STOP
```

---

## Sub 4 — PlayerVisual extension

```
Persona: SKILL.md. Lát D.U9 Sub 4.

## Read
- SUBTASKS.md Sub 4 (edits)
- PLAN.md §6.4, §6.5, §6.6 (slug change detection, parent to capsule, Y offset)
- Existing PlayerVisual.cs

## Do
- Edit Assets/RadiantArena/Scripts/Arena/PlayerVisual.cs:
  - Add fields: _currentWeaponSlug (string=""), _weaponGo (GameObject? = null), const WeaponOffsetY = 0.8f.
  - In SyncFromContext, after the existing position-update block (before final return), add weapon-attach logic:
    - read locked = p.LockedWeapon
    - newSlug = locked?.Slug ?? ""
    - if newSlug != _currentWeaponSlug: destroy old _weaponGo, update _currentWeaponSlug, if newSlug not empty → WeaponPrefabRegistry.Spawn + reset localPosition to (0, WeaponOffsetY, 0) + WeaponHueApplier.Apply.
  - In SyncFromContext's null-snapshot early-return branch: also destroy any live _weaponGo + reset state.
- refresh_unity scope=scripts; read_console zero new.

## Commit
feat(arena-unity/Lát-D.U9): PlayerVisual spawns weapon via WeaponPrefabRegistry on LockedWeapon.Slug change + applies hue

## STOP
```

---

## Sub 5 — Mock smoke + Bill visual sign-off (NO commit)

```
Persona: SKILL.md. Lát D.U9 Sub 5.

## Pre
- Bootstrap.unity loaded as active scene (Build Settings fixer already applied per D.U8).
- manage_editor stop then play.
- compiler=codedom.

## Do
1. read_console clear.
2. execute_code: prime ArenaContext + inject MyPlayer/OpponentPlayer with LockedWeapon (slug + hue per Sub 5 spec). Drive to Countdown.
3. Wait 0.2s. Probe:
   - MyVisual.transform.childCount → 1 child named "Weapon_weapon_kiem_01"
   - First MeshRenderer MPB _BaseColor → matches injected hue
4. Swap MyPlayer.LockedWeapon slug to "weapon_thiet_con_01" + new hue. Wait 0.2s. Probe: child renamed, color updated.
5. MyPlayer.LockedWeapon = null. Wait 0.2s. Probe: childCount = 0.
6. Slug = "weapon_invalid_xyz". Wait 0.2s. Probe: placeholder child (single sphere) + warn log.
7. manage_editor stop. read_console types=["error"] → 0.

## Bill manual
- Re-play. Drive to Countdown via mock recipe. See me + opp capsules with their weapon attachments + hue tints.
- Cycle through 6 catalog slugs via execute_code paste (one at a time) — observe distinct shapes.
- Sign-off D.U9 close.

## Output
- Probe pass/fail per step.

## STOP — no commit. REPORT.md follows.

## Fallback
- If URP `_BaseColor` ID returns 0 (property doesn't exist on the active shader), MPB SetColor still no-ops gracefully — visual stays white. Log + investigate which shader is actually loaded.
- If LockedWeapon snapshot reflection injection awkward, fabricate a new PlayerSnapshot with the LockedWeapon already set + swap via ArenaContext property setter (same pattern as D.U6/D.U8 mock smoke).
```

---

## Bill checkpoints

| After | Action |
|---|---|
| Sub 1 | Confirm baseline. |
| Sub 2 | (Optional) review placeholder shape choices — Bill can suggest different primitives if not visually distinct. |
| Sub 3 | (Optional) MPB pattern OK. |
| Sub 5 | Mock probes + visual sign-off → close D.U9. |

## Notes
- Pre-commit hook fail → NEW commit per global rule.
- D.U7b anticipation pulse (weapon scale 1.0→1.15 before release) now UNBLOCKED by this Lát but stays deferred in juice scope.
- Next Lát: D.U10 UI fantasy polish (Bill's earlier flag — calligraphic font, ink overlay, tier color coding).
