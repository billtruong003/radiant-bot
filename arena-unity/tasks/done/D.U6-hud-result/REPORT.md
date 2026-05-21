# D.U6 — HudPanel + ResultPanel · REPORT

> Closed 2026-05-18 (Opus 4.7, sequential auto-run per D.U4/D.U5 precedent).

---

## Result: D.U6a PASS · D.U6b deferred as planned

Combat-phase HUD + terminal ResultPanel both ship with full client wiring. NetClient now diffs `PlayerSchema.hp` per state tick and fires `HpChangedEvent`; HudPanel subscribes, animates HP bars via `BillTween.Float(...)`, and consolidates the canonical turn timer (dropped from TurnInputPanel). New `EndState` opens ResultPanel from `MatchEndedEvent` with a race-fallback through `ArenaContext.LastMatch*` cache. All 5 mock-smoke steps pass with zero errors.

### Mock-smoke chain (all 5 scenarios in one Play session)

```
─ Step A — drive into Countdown ───────────────────────────────────────────────
[Bill.State] Boot -> Countdown
[Arena.Countdown] Enter — server lock, awaiting phase=active
[Arena.HUD] opened, snapping bars me=100/100 opp=100/100
→ afterGoTo=Countdown · hudOpen=True

─ Step B + C — HP diff events (BillTween animated) ────────────────────────────
[Arena.HUD] HP opp 100→75/100
[Arena.HUD] HP me  100→40/100
probe after 0.8s sleep:
  me  bar: width%=40.0 bg=RGBA(0.950, 0.850, 0.300, 1.000)   ← yellow (>25, ≤50)
  opp bar: width%=75.0 bg=RGBA(0.300, 0.860, 0.550, 1.000)   ← green  (>50)

─ Step D — MatchEnded (race-fallback path) ────────────────────────────────────
[Arena.End] Enter — closing HUD + opening ResultPanel
[Arena.End] replaying cached LastMatch* (arrived before Enter)
probe ResultPanel:
  banner='Trận đấu THẮNG' classWin=True classLose=False
  outcome='(win)' hpMe='me: 40 HP' hpOpp='opp: 0 HP'
→ state=End · hudOpen=False · resultOpen=True

─ Step E — Loser perspective (MyDiscordId="opp") ──────────────────────────────
Bounce: GoTo<LobbyState> (defensive close), swap MyDiscordId, GoTo<EndState>.
probe:
  banner='Trận đấu THUA' classWin=False classLose=True
→ state=End · resultOpen=True
```

Final `read_console types=["error"]` after Play stop: **0 entries**. Zero new errors introduced (baseline warnings — URP missing-types + BillInspector dup menu item — unchanged).

---

## Sub-by-sub status

| Sub | Status | Commit | Notes |
|---|---|---|---|
| Stage 1 docs | ✅ | `4046abd` | PLAN + SUBTASKS + OPUS_PROMPTS. |
| 1. Verify baseline | ✅ | — | Console clean; no prior BillTween consumer; NetClient.cs:102 still stub; `Bill.UI.Open<T>` confirmed idempotent (`CoreServices.cs:122-132` — `GetOrCreate` reuses, then `Show()`). |
| 2. Events + Ctx | ✅ | `f0b2942` | +2 events (HpChangedEvent + MatchEndedEvent); +3 LastMatch ctx fields + Reset() wipes. |
| 3. NetClient HP diff + OnMatchEnded | ✅ | `016c135` | +`_lastHp` dict; OnStateChange iterates state.players + fires HpChangedEvent on delta; OnMatchEnded snapshot fires MatchEndedEvent; Disconnect/OnLeave clear `_lastHp`. |
| 4. HudPanel UXML + USS + .cs | ✅ | `38d2a84` | 2 HP bars + canonical turn timer + round/turn indicator; BillTween.Float on HpChangedEvent + KillTarget before each new tween; green→yellow→red color ramp at >50/>25 thresholds. |
| 5. ResultPanel UXML + USS + .cs | ✅ | `935b9db` | Centered modal; banner Vietnamese verdict + class toggle (win/lose/draw); stub buttons log only. Loads `result.uss` + `lobby.uss` for `.btn` inheritance. |
| 6. EndState + wiring | ✅ | `a25c3fc` | EndState + register + phase=ended routes from Countdown/Lobby/MyTurn/OpponentTurn/Animating; Countdown opens HudPanel; Lobby defensive closes HudPanel + ResultPanel. |
| 7. TurnInputPanel timer refactor | ✅ | `0a2292c` | Dropped `<Label name="timer">`, `_timer` field, `RefreshTimer` method, scheduler subscribe/unsubscribe. Header comment updated. |
| 8. Mock smoke | ✅ | — | All 5 scenarios pass; HpChangedEvent → BillTween-driven width + color verified via reflection probe; race-fallback path exercised; loser perspective banner correct. |

---

## Deviations from PLAN

1. **EndState.cs compile-error race during Sub 6.** First `refresh_unity scope=scripts` after Sub 6 writes reported `error CS0246: The type or namespace name 'EndState' could not be found` from all 5 referring state files even though `EndState.cs` was on disk. Cause: Unity's asset import hadn't picked up the new file yet — same D.U5 Sub 4 pattern. Fix: `refresh_unity scope=all mode=force` once and the error cleared. Future Láts that create new state/UI files should default to `scope=all mode=force` after a write, not the lighter `scope=scripts`.

2. **PLAN §6.5 "color ramp red at 40%" was wrong — code says yellow.**
   PLAN §10 mock-smoke description called the 40% bar `red zone color ramp`, but the actual code (`HudPanel.cs:HpColor`) uses 50/25 thresholds: `pct > 50 → green`, `pct > 25 → yellow`, `else red`. 40% → yellow. The mock probe confirms RGBA(0.950, 0.850, 0.300) which is the yellow constant. Behavior is correct; the PLAN narrative was off by one. (No code change — the ramp matches the spec in PLAN §6.5 itself; only the §10 prose was inconsistent.)

3. **Step E (loser-perspective smoke) executed but skipped the GoTo<LobbyState> log capture.**
   PLAN §10 listed Step E as optional. We ran it anyway to validate the class swap (`.win` ↔ `.lose`). The path goes `GoTo<LobbyState>` (closes ResultPanel defensively) → swap MyDiscordId → `GoTo<EndState>` again → race-fallback re-renders from LastMatch* cache. Verified via reflection probe: `banner='Trận đấu THUA' classWin=False classLose=True`.

4. **Reflection probe needed `System.Collections.IDictionary` not the generic version.**
   When inspecting `Bill.UI._panels` (a `Dictionary<Type, BasePanel>`), our first probe wrote `System.Collections.Generic.IDictionary` without type parameters and CodeDom rejected (`Using the generic type ... requires 2 type argument(s)`). Fixed by casting to non-generic `System.Collections.IDictionary` + iterating `DictionaryEntry`. Worth noting for future smoke probes that iterate Bill internals.

5. **No explicit `Bill.UI.Open<HudPanel>` guard test under "already open" scenario.**
   Sub 1 verified the API surface (`CoreServices.cs:122-132` — `GetOrCreate` + `Show` is idempotent). CountdownState.Enter still uses the defensive `if (!Bill.UI.IsOpen<HudPanel>())` guard per PLAN §6.3. Smoke didn't exercise the "open twice" path explicitly; the guard means it'd be a no-op anyway. Acceptable.

---

## Bill checkpoints

| Checkpoint | Outcome |
|---|---|
| Sub 1 | Baseline confirmed: BillTween fresh, NetClient stub, Open idempotent. |
| Sub 4-5 | Layout sanity skipped — sequential auto-run. UXML structure visible in `38d2a84` + `935b9db` if Bill wants to revisit. |
| Sub 8 | All 5 mock-smoke scenarios pass with reflection-verified bar widths + colors + banner text. D.U6a closed. |

---

## What's left for D.U6b (post-server-D.5)

1. Server Lát D.5: ship `radiant-bot/arena-server/src/physics/trajectory.ts` + wire `DuelRoom.handleShoot` to call `simulateShot()` with real damage output. Until then `shot_resolved` broadcasts `trajectory: []` + `damage_dealt: 0` and HP doesn't decrement server-side.
2. Live 2-instance ParrelSync smoke: both clients connect → combat phase → shot lands → `state.players[victim].hp` decrements → state diff fires `HpChangedEvent` → HudPanel bar tweens → eventually HP=0 → server broadcasts `match_ended` → `OnMatchEnded` handler fires → EndState opens ResultPanel.
3. Visual feel pass: Bill manual Game View — verify bar shrink timing feels right at 400ms, color transitions read at gameplay distance, timer pulse at ≤5s reads as "urgent".

---

## What's left for downstream Láts (not D.U6 scope)

- **D.U7 juice**: HP bar pop scale (1.0→1.15→1.0 over 150ms) on damage, screen-flash on crit, hit-stop, layered audio on hit/crit/match-end.
- **D.U10/D.U11**: real wiring for `Chơi lại` (replay viewer) + `Về sảnh` (back-to-lobby flow). Today both buttons log only.
- **D.U7 / D.U8**: weapon names in HudPanel currently fall back to `SelectedWeaponSlug` if `LockedWeapon == null` — once D.U8 ships weapon-prefab + display-name lookups properly, the HUD text will be friendlier.

---

## Known baseline (NOT D.U6 issues)

- `Missing types referenced from component UniversalRenderPipelineGlobalSettings` — D.U1 URP downgrade leftover.
- `Cannot add menu item 'Tools/BillInspector/Validation Window'` — pre-existing dup from ArenaDevMenu + BillInspector registration order (untracked file, not D.U6).
- 3× `No Theme Style Sheet set to PanelSettings` carryover — D.U3 patches `Bill.UI` at runtime; DebugOverlay + CheatConsole still warn at boot.

---

## Files added/edited

| Path | Lines | Status |
|---|---|---|
| `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs` | +28 | edit (+2 events) |
| `Assets/RadiantArena/Scripts/Net/ArenaContext.cs` | +11 | edit (+3 LastMatch fields + Reset wipes) |
| `Assets/RadiantArena/Scripts/Net/NetClient.cs` | +49 / −2 | edit (HP diff loop + OnMatchEnded handler + _lastHp clears) |
| `Assets/RadiantArena/Scripts/States/EndState.cs` | 62 | new |
| `Assets/RadiantArena/Scripts/States/ArenaStates.cs` | +1 | edit (register EndState) |
| `Assets/RadiantArena/Scripts/States/CountdownState.cs` | +9 / −3 | edit (open HudPanel + handle phase=ended) |
| `Assets/RadiantArena/Scripts/States/LobbyState.cs` | +5 / −1 | edit (defensive HUD close + phase=ended → EndState) |
| `Assets/RadiantArena/Scripts/States/AnimatingState.cs` | +1 / −1 | edit (phase=ended → EndState) |
| `Assets/RadiantArena/Scripts/States/MyTurnState.cs` | +1 | edit (phase=ended → EndState) |
| `Assets/RadiantArena/Scripts/States/OpponentTurnState.cs` | +1 | edit (phase=ended → EndState) |
| `Assets/RadiantArena/UI/HudPanel.cs` | 188 | new |
| `Assets/RadiantArena/UI/Resources/HudPanel.uxml` | 38 | new |
| `Assets/RadiantArena/UI/Resources/hud.uss` | 122 | new |
| `Assets/RadiantArena/UI/ResultPanel.cs` | 99 | new |
| `Assets/RadiantArena/UI/Resources/ResultPanel.uxml` | 21 | new |
| `Assets/RadiantArena/UI/Resources/result.uss` | 67 | new |
| `Assets/RadiantArena/UI/TurnInputPanel.cs` | +1 / −27 | edit (drop timer + scheduler) |
| `Assets/RadiantArena/UI/Resources/TurnInputPanel.uxml` | −1 | edit (drop timer Label) |
| (meta sidecars) | — | auto-generated by Unity import |

Stage 1 docs: ~1510 lines under `arena-unity/tasks/todo/D.U6-hud-result/`.

---

## Commits (this Lát)

```
0a2292c refactor(arena-unity/Lát-D.U6): move turn-timer ownership from TurnInputPanel to HudPanel — drop duplicate render
a25c3fc feat(arena-unity/Lát-D.U6): add EndState + register + wire phase=ended from Countdown/MyTurn/OpponentTurn/Animating/Lobby + Countdown opens HudPanel + Lobby closes leftover HUDs
935b9db feat(arena-unity/Lát-D.U6): add ResultPanel BasePanel + UXML + USS — winner banner + outcome + final HPs + stub buttons
38d2a84 feat(arena-unity/Lát-D.U6): add HudPanel BasePanel + UXML + USS — HP bars (BillTween animated), turn timer, round/turn indicator
016c135 feat(arena-unity/Lát-D.U6): NetClient HP diff loop + OnMatchEnded handler
f0b2942 feat(arena-unity/Lát-D.U6): add HpChangedEvent + MatchEndedEvent + LastMatch ctx
4046abd docs(arena-unity/Lát-D.U6): Stage 1 architect — PLAN + SUBTASKS + OPUS_PROMPTS
```

---

## Next lát: D.U7 — Juice pass

Prereqs unblocked by D.U6a:
- ✅ `PlayerHitEvent` (D.U5) + `HpChangedEvent` (D.U6) both fire reliably — juice can subscribe either depending on whether it wants hit-marker timing or post-state damage.
- ✅ HudPanel has the HP-bar fills + container hierarchy ready for pop-scale animations.
- ✅ Bill.Tween facade confirmed working with VisualElement.style.* — same setter pattern can drive pop scale (`element.transform.scale = new Vector3(s, s, 1)` via UI Toolkit's `style.scale`).

Prereqs STILL blocked:
- ⏸ Server Lát D.5 physics (real damage → real HP drops in live smoke). D.U7 juice can be developed mock-only against synthetic events.
