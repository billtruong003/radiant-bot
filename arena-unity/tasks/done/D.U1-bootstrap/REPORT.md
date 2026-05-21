# D.U1 — Bootstrap · REPORT

> Closed 2026-05-17 (executor: Claude Opus 4.7, 1M ctx)
> Source plan: `PLAN.md` · Sub breakdown: `SUBTASKS.md` · Prompts used: `SONNET_PROMPTS.md` (renamed to opus_PROMPTS in header)

---

## Result: PASS

D.U1 DoD met. Smoke logs from Play mode (final run, post-Sub 2 WebGL switch):

```
[Bill] + Infrastructure (2.3ms)
[Bill] + Core Services (32.0ms)
[Bill] + State Machine (1.0ms)
[Bill] + Network (0.1ms)
[Bill] + Dev Tools (11.5ms)
[Bill.State] None -> Boot
[Bill] Ready. 14 services in 398ms.
[Arena] bootstrap ready (Bill.IsReady=True)
```

All 5 phases initialized, gate (`Bill.IsReady` / `GameReadyEvent`) wired correctly, `ArenaBootstrapReadyEvent` fires as designed.

---

## Sub-by-sub status

| Sub | Status | Commit | Notes |
|---|---|---|---|
| 1. Verify baseline (read-only) | ✅ | — | Verified before Stage 2 (Sonnet 4.6 session, 2026-05-15) |
| 2. WebGL switch + PlayerSettings | ✅ | `8a8aa42` | IL2CPP (auto), .NET Std 2.1, **1280×720** web res. Platform target stored in `UserSettings/` (gitignored). |
| 3. Colyseus SDK + ParrelSync + NativeWebSocket | ✅ | bundled `55660c8` + `0c91d48` (lock resolve) | NativeWebSocket branch `#upm` → `#upm-2` (upstream rename — fixed in 0c91d48). |
| 4. BillBootstrapConfig.asset | ✅ | bundled `55660c8` | Field values per PLAN §5: targetFps=60, vSync=0, enforceBootstrap=true, includeDebugOverlay=true, includeCheatConsole=true, returnToEditScene=true. |
| 5. RadiantArena folder layout | ✅ | bundled `55660c8` | 8 folders: Scenes/, Scripts/{Bootstrap,Net,States,Events,UI}/. |
| 6. ArenaEvents.cs placeholder | ✅ | bundled `55660c8` | `ArenaBootstrapReadyEvent : IEvent`. |
| 7. ArenaBootstrap.cs | ✅ | bundled `55660c8` | GameReadyEvent gate pattern (sync check + SubscribeOnce fallback). `#nullable enable`. |
| 8. Bootstrap.unity scene | ✅ | bundled `55660c8` | `[ArenaBootstrap]` GO + Main Camera + Directional Light, build index 0. |
| 9. Smoke verify | ✅ | (no commit, see logs above) | Verified twice — once on Windows64 target, once on WebGL target. Both green. |

---

## Deviations from PLAN

1. **Single bundled scaffold commit (`55660c8`) instead of 6 per-sub commits.**
   Stage 2 was executed via filesystem-only writes during a session where Unity MCP was unavailable, so Subs 3–8 were committed together as the initial project commit. Verification + clean-up happened in this Opus session.

2. **Input handler set to "Both" (`activeInputHandler: 2`) instead of Input System only.**
   Bill's `DevTools.CheatConsole` calls `UnityEngine.Input.GetKeyDown`. With Input System only (`activeInputHandler: 1`) Unity throws each tick — `Bill.IsReady` still reaches `True`, but the console spams errors. Set to Both as the cheapest fix in scope for D.U1. Long-term cleanup: port CheatConsole to Input System (defer to a BillGameCore housekeeping lát, not D.U1).

3. **`.mcp.json` switched from stdio → HTTP transport (port 8080).**
   MCP for Unity package `com.coplaydev.unity-mcp@13fb3ee12774` (v9.6.8) launches its own HTTP server inside the Editor. The original stdio config spawned a duplicate that couldn't find Unity. Updated to point at the in-editor HTTP server. Forward-compatible with newer MCP for Unity versions.

4. **Unity 6000.3.0f1 → 6000.2.7f2 downgrade mid-task (commit `c74c427`).**
   Bill downgraded after observing 6.3 was too new for shared Unity Hub. Two follow-up cleanups required:
   - `Packages/manifest.json` had two entries with no 6.2 equivalent (`com.unity.modules.adaptiveperformance`, `com.unity.modules.vectorgraphics`) — removed. The vectorgraphics one was a typo (the real package is `com.unity.vectorgraphics`, not a built-in module).
   - `BillSceneSwitcher` toolbar used `UnityEditor.Toolbars.MainToolbar*` (6.3+ only) — wrapped both `BillSceneSwitcherToolbar.cs` and `BillSceneSwitcherMenuItems.cs` in `#if UNITY_6000_3_OR_NEWER`. On 6.2, the menu-item entry point (`BillGameCore > Scene Switcher`, `Ctrl+Shift+S`) still works; the toolbar dropdown is compiled out.
   - `BillSceneSwitcherData.cs:108` got CS0108 (`SetDirty()` hides inherited member) — added `new` keyword.

---

## Known baseline issues (NOT introduced by D.U1, defer separately)

1. **3× `No Theme Style Sheet set to PanelSettings, UI will not render properly`** — fires during `BillGameCore.UIService.Initialize` (`CoreServices.cs:115`), `DebugOverlay.Initialize` (`DevTools.cs:33`), and `CheatConsole.BuildUI` (`DevTools.cs:156`). Cosmetic; UI still functional. Track as BillGameCore framework housekeeping.

2. **1× `Missing types referenced from component UniversalRenderPipelineGlobalSettings`** (3 missing type refs: `URPReflectionProbeSettings`, `RayTracingRenderPipelineResources`, `OnTilePostProcessResource`) — leftover after URP 17.3 → 6.2-compatible version downgrade. Auto-repair runs on first save of URP settings; not blocking. Track for a separate "URP asset migration" cleanup.

3. **VFX Graph "outdated version" warnings (6 sample assets)** — Cinemachine VFX samples that need a Rebuild Visual Effect Graph pass. Defer to before D.U7 (juice/VFX work).

---

## Packages installed

| Package | Version | Source |
|---|---|---|
| `io.colyseus.sdk` | git `08ba8e2` | github.com/colyseus/colyseus-unity-sdk?path=Assets/Colyseus |
| `com.veriorpies.parrelsync` | git latest | github.com/VeriorPies/ParrelSync?path=/ParrelSync |
| `com.endel.nativewebsocket` | `#upm-2` | github.com/endel/NativeWebSocket (Colyseus transitive dep) |

---

## Files added (lifetime tally, across all commits)

| Path | Purpose |
|---|---|
| `Assets/Resources/BillBootstrapConfig.asset` | Framework boot config |
| `Assets/RadiantArena/Scenes/Bootstrap.unity` | Boot scene, build index 0 |
| `Assets/RadiantArena/Scripts/Events/ArenaEvents.cs` | `ArenaBootstrapReadyEvent` (D.U2+ will add more) |
| `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs` | Bill gate + Arena bootstrap fire |
| `Assets/RadiantArena/Scripts/{Net,States,UI}/` | Empty placeholders for D.U2+ |
| `.claude/settings.json` | Project MCP read-only allowlist (this session) |

---

## Commits

```
8a8aa42 chore(arena-unity/Lát-D.U1): D.U1 Sub 2 WebGL player settings
c74c427 chore(arena-unity): downgrade Unity 6000.3 → 6000.2.7f2 + 6.2 compat shims
4a2beb9 chore(arena-unity/Lát-D.U1): rename Sonnet → opus in prompts doc
0c91d48 chore(arena-unity/Lát-D.U1): verify Stage 2 smoke test + Unity setup resolves
d7b3edf chore: fix task folders + handoff with copy-paste prompts
55660c8 chore: initial project commit — D.U1 bootstrap scaffold
```

---

## Next lát: D.U2 — NetClient + Colyseus connect

Prereqs unblocked by D.U1:
- ✅ Colyseus SDK on `manifest.json`
- ✅ `[ArenaBootstrap]` fires `ArenaBootstrapReadyEvent` (D.U2's NetClient will subscribe to this)
- ✅ `Assets/RadiantArena/Scripts/Net/` folder ready

Next session: enter Stage 1 for D.U2 — architect drafts `PLAN.md` + `SUBTASKS.md` per persona `arena-unity/SKILL.md`.
