# Tasks — Radiant Arena Unity Client (Lát D.U)

> High-level Lát plan cho Unity WebGL client. Mỗi Lát ship được riêng. **Workflow + priority order**: xem `ROADMAP.md`. **Persona + MCP usage**: xem `SKILL.md`. Scope chi tiết per Lát ở dưới đây — Opus break thành subtask detail trong `tasks/todo/D.Ux-*/SUBTASKS.md` khi vào từng Lát.
>
> **Đọc trước:** `ROADMAP.md` (workflow), `SKILL.md` (persona), `RADIANT_ARENA_UNITY.md` (implementation guide), `Assets/BillGameCore/Runtime/Infrastructure/Interfaces.cs` (API surface).
>
> **Hiện trạng (server side):** arena-server đã ship Lát D.1 (scaffold) + Lát D.2 (DuelRoom skeleton + HMAC auth + Colyseus schemas, commit `d701968`). Unity work bắt đầu được từ D.U1; nhưng D.U2 cần `scripts/seed-room.ts` của arena-server (Lát D.3, chưa ship) để smoke 2-client local. Workaround: dùng dev token tự sign trong Unity Editor — xem D.U2 scope.
>
> **Hiện trạng (Unity side):** Unity project ĐÃ TỒN TẠI tại `d:\Projects\ArenaPK\`, BillGameCore đã import sẵn ở `Assets/BillGameCore/`. D.U1 scope = verify boot + folder layout + ArenaBootstrap skeleton (KHÔNG phải tạo project từ zero).
>
> **BillGameCore API doc:** `BILLGAMECORE_API.md` KHÔNG tồn tại. Fallback chính thức: agent đọc trực tiếp `Assets/BillGameCore/Runtime/Infrastructure/Interfaces.cs` + `Bootstrap/Bill.cs` + relevant `Services/*.cs` để nắm API surface. Đừng tạo doc giả — đọc source là source of truth.

---

## 🆕 Lát D.U1 — Unity project bootstrap

**Goal:** Verify BillGameCore boot trong existing Unity project, scaffold folder layout `Assets/RadiantArena/`, write `ArenaBootstrap.cs` skeleton gated on `GameReadyEvent`.

> **Pre-existing state (verify trước khi bắt đầu)**:
> - Unity project ĐÃ TỒN TẠI tại `d:\Projects\ArenaPK\`. KHÔNG cần Unity Hub → New Project.
> - BillGameCore đã import ở `Assets/BillGameCore/`. KHÔNG cần install lại.
> - Framework auto-boots via `[RuntimeInitializeOnLoadMethod]` — **không gọi `Bill.Init()`** (method không tồn tại).

**Scope:**
- Verify `Assets/Resources/BillBootstrapConfig.asset` tồn tại (create via `mcp__unityMCP__manage_asset` nếu chưa). Framework abort boot nếu missing.
- Player Settings via `mcp__unityMCP__manage_editor`: switch platform → WebGL, .NET Standard 2.1, resolution 1280×720.
- Install packages còn thiếu (`mcp__unityMCP__manage_packages` query trước):
  - Colyseus Unity SDK — git URL `https://github.com/colyseus/colyseus-unity-sdk.git?path=Assets/Colyseus`
  - Cinemachine, ShaderGraph (Unity registry)
  - URP (verify nếu chưa active)
  - ParrelSync — `https://github.com/VeriorPies/ParrelSync.git?path=/ParrelSync`
  - **Skip**: UI Toolkit (Unity 6 built-in `com.unity.modules.uielements`), BillGameCore (đã có).
- Tạo folder layout `Assets/RadiantArena/` theo `RADIANT_ARENA_UNITY.md` §1.3 — chỉ Scenes/, Scripts/Bootstrap/, Scripts/Net/, Scripts/States/, Scripts/Events/ trước; phần khác lazy theo Lát sau.
- Tạo `Bootstrap.unity` scene (build index 0) qua `mcp__unityMCP__manage_scene`, với GameObject `[ArenaBootstrap]` attached.
- Write `Assets/RadiantArena/Scripts/Bootstrap/ArenaBootstrap.cs` — gate on `Bill.IsReady`/`Bill.Events.SubscribeOnce<GameReadyEvent>`, log "Arena bootstrap ready" sau khi gate pass.
- Smoke test qua MCP: `manage_editor` enter Play → `read_console` thấy `[Bill] Ready. N services in Xms.` + "Arena bootstrap ready" → exit Play. Zero errors.

**DoD:** 
- Unity Console clean (zero errors, no new warnings beyond baseline).
- `[Bill] Ready.` log visible khi Play (proof BillGameCore boot success).
- `ArenaBootstrap` log "ready" sau gate (proof gate pattern hoạt động).
- Folder layout match `RADIANT_ARENA_UNITY.md` §1.3 (verify qua `mcp__unityMCP__manage_asset` listing).

---

## 🌐 Lát D.U2 — NetClient + Colyseus connect

**Goal:** `NetClient` is the only MonoBehaviour touching Colyseus SDK. 2 Editor instances connect to same room, both see `state.phase=lobby`.

**Scope:**
- `NetClient.cs` — `Connect(ConnectionInfo)`, `room.OnStateChange`, `room.OnLeave`.
- `MessageSchemas.cs` — C# schema classes mirroring `arena-server/src/rooms/schemas.ts`. **2 chiến lược:**
  - **Option A (recommended)** — hand-mirror: 7 plain C# classes (or Colyseus's `Schema` subclasses if SDK version requires) tương ứng `DuelState`, `PlayerSchema`, `WeaponSchema`, `WeaponStatsSchema`, `WeaponVisualSchema`, `WeaponSkillSchema`, `TrajectoryPointSchema`. Khi server schema thay đổi → manual sync. Pros: control + clarity.
  - **Option B** — Colyseus `schema-codegen` CLI tự generate C# từ `.fbs` file. Pros: 0 manual sync. Cons: cần generate `.fbs` từ TS schema (Colyseus SDK có script). Bỏ qua nếu Option A đủ — server schemas chỉ có 7 class, hand-mirror nhanh.
- `MessageTypes.cs` — outbound message payload structs (`SelectWeaponMsg { string slug }`, `ShootMsg { float angle; float power }`, etc.).
- `ArenaContext.cs` — static singleton holding match snapshot + hydration helpers.
- `ManualRoomConnect.cs` (Editor-only) — paste ws URL + token + room ID, right-click → Connect for testing.
- `BootState.cs` — parse URL query (`?room=X&t=Y`) on WebGL build via JS interop hoặc `Application.absoluteURL`.
- `ConnectingState.cs` — show ConnectingPanel, await Connect, transition to LobbyState on success.

**Token workaround (until arena-server D.3 ships):**
- D.3 sẽ ship `arena-server/scripts/seed-room.ts` để gen 2 dev token + spawn room qua admin endpoint.
- Tạm thời: viết `DevTokenSigner.cs` (Editor-only) tự sign HMAC token bằng shared secret (Bill hardcode trong Editor PlayerPrefs, không commit). Test connect tới room mà bot/seed-room đã tạo. Khi D.3 ship thì delete DevTokenSigner.

**DoD:** Run `arena-server` locally + `scripts/seed-room.ts` (after D.3) hoặc DevTokenSigner (interim) để get 2 token; paste vào 2 Editor instances qua ParrelSync; cả 2 join thành công, log `state.phase=lobby`.

---

## 🪙 Lát D.U3 — LobbyPanel + weapon pick UI

**Goal:** UIToolkit panel renders list of weapons that **server emitted** in `state.players[me].available_weapons` (NOT a hardcoded UI list). Player picks → Send("pick_weapon") + Send("ready") → countdown.

**Scope:**
- `LobbyPanel.uxml` + `lobby.uss` (UI Toolkit theme).
- `LobbyPanel.cs` extends BillGameCore `BasePanel`.
- ListView populated from `ArenaContext.AvailableWeaponsForMe`.
- Selection state → `ArenaContext.PickedWeaponSlug`.
- "Sẵn sàng" button → send messages.
- Opponent status indicator (waiting / ready).

**DoD:** Both players see only weapons server told them about. Picking changes state. Both Ready → server flips phase=countdown.

---

## 🎯 Lát D.U4 — TurnInputPanel + drag-aim mechanic

**Goal:** During own turn, drag from weapon position → power gauge fills + aim line draws → release → Send("shoot", { angle, power }).

**Scope:**
- `TurnInputPanel.cs` (UIToolkit overlay + scene LineRenderer).
- Mouse + touch input (Input.touchCount fallback to mouse).
- Drag start point = weapon slot world position.
- Max drag distance maps to power 0-1; dead zone <10%.
- Aim line via LineRenderer; angle calc via Atan2.
- Power gauge UI element (UIToolkit slider).
- Turn timer countdown UI (30s, warning at 5s).
- `MyTurnState.cs` opens panel, subscribes OnShotReleased → NetClient.Send.

**DoD:** Editor instance A drags + releases; server (Lát D.4 turn loop) confirms; client transitions to AnimatingState.

---

## 💥 Lát D.U5 — TrajectoryRenderer playback

**Goal:** When `shot_resolved` event arrives, render projectile traveling along `points[]` from server, spawn FX at event points, update HP visuals.

**Scope:**
- `TrajectoryRenderer.cs` — async `Play(points, shooter, dmgDealt)`.
- Interpolate by `point.t` timestamps (relative ms).
- Spawn `trajectory_dot` pool item every step.
- HandleEvent dispatch:
  - `wall_bounce` → fx + camera shake
  - `hit:<dmg>` / `crit:<dmg>` → impact fx + damage number + time slow + audio
  - `pierce_player:<id>` → slow-mo + arc fx
  - `stop` → settle puff
- `AnimatingState.cs` runs Play, Sends `animation_complete` when done.
- HP changes via state diff → `PlayerVisual.cs` HP bar animates.

**DoD:** Smoke duel runs end-to-end: drag → shot → trajectory plays → hit → HP drops → next turn fires. Both Editor instances see synchronized trajectory.

---

## 🎨 Lát D.U6 — HudPanel + ResultPanel

**Goal:** HP bars always visible during active phase. Result screen on match end.

**Scope:**
- `HudPanel.uxml` — 2 HP bars (player slot orientation), turn timer, current weapon name.
- HP bar uses `Bill.Tween.To` for fill animation on HpChangedEvent.
- Turn timer shows remaining seconds, color shifts red at <5s.
- `ResultPanel.uxml` — winner banner, "Trận đấu thắng/thua" headline, replay link button, return to lobby button.
- `EndState.cs` opens ResultPanel on MatchEndedEvent.

**DoD:** UI clearly shows match state through all phases. Result screen renders correctly for both win + lose perspectives.

---

## ✨ Lát D.U7 — Juice pass

**Goal:** "It feels good." Camera shake, time slow, damage number popups, layered audio, color flash on hit/crit.

**Scope:**
- Cinemachine ImpulseSource on `Camera.main` — generate impulse on wall_bounce / hit / crit with magnitude varying.
- Time slow function: `Time.timeScale = 0.3f; Bill.Timer.Delay(0.2f, restore)`.
- DamageNumber prefab: outline + drop shadow, Bill.Tween scale 1.2 → 1.0 over 80ms, then arc upward + fade.
- Layered audio: hit = body thud + harmonic ring + sub-bass (3 SFX one-shots).
- Color flash via Volume profile: chromatic abber spike + vignette dark briefly.
- Anticipation: weapon model pulses 1.0 → 1.15 over 80ms before release.

**DoD:** Bill subjective sign-off: "feels punchy." No "flat" hits.

---

## 🌅 Lát D.U8 — Arena scene (map + players + camera)

> **Pivot 2026-05-18:** original D.U8 scope (6-weapon catalog) deferred to D.U9. New scope below — **visible combat first** so playtest feels concrete. Deploy moved to D.U12 (LAST).

**Goal:** Open Play, focus Game View, immediately see top-down orthographic arena with 2 player capsules + ground + walls + drag-aim line originating from my-player.

**Scope:**
- `ArenaSceneBuilder.cs` (singleton MonoBehaviour, spawned by `ArenaBootstrap.InitArena`) — configure Main Camera (ortho top-down `(0, 10, 0)` Euler `(90, 0, 0)` size 6) + runtime-spawn ground Plane (10×10 world units = sim 1000×1000 via `TrajectoryConstants.WorldFromSim`) + 4 wall Cubes at borders + 2 player Capsules at slot anchors (me=`(-3, 0.5, 0)` green, opp=`(3, 0.5, 0)` orange).
- `PlayerVisual.cs` — attached to each capsule; polls `ArenaContext.MyPlayer/OpponentPlayer.X/Y` every 100ms; `transform.position = WorldFromSim(x, y)` (Y kept at capsule center 0.5); fallback to SlotAnchor when server uninitialized (x=y=0).
- `ArenaAimController.SetOrigin` wired from `MyTurnState.Enter` passing `ArenaSceneBuilder.Instance.MyVisual.transform` — drag-aim line now origins at my-player capsule (not `Vector3.zero` as today).
- `ArenaBuildSettingsFixer.cs` (Editor menu `Tools > RadiantArena > Set Bootstrap as Scene 0`) — one-shot Bill runs once to prevent SampleScene-loaded-by-default sessions.
- All runtime-spawn — no scene-file diff to Bootstrap.unity (precedent: JuicePresenter D.U7).
- Materials inline via URP/Unlit shader, no `.mat` assets.

**Out of scope:**
- Weapon prefabs / hue tint — D.U9.
- UI fantasy polish — D.U10.
- HLSL toon/outline shaders — D.U11.
- WebGL deploy — D.U12 (LAST phase).
- Animations / IK / player rigs — future.
- Audio (footstep / ambient) — D.U7b or beyond.

**DoD:** Bill enters Play (after fixer applied), sees arena top-down + 2 capsules + drag-aim from green capsule + D.U7 juice effects firing on synthetic events. Mock smoke probes Camera ortho config + scene GO presence + aim controller origin = MyVisual.transform. Bill subjective visual sign-off.

---

## 🗡️ Lát D.U9 — Weapon spawn factory (was named "prefab catalog")

> **Status:** ✅ closed 2026-05-19. **Misnomer note:** Lát name implied `.prefab` files; PLAN §6.1 chose runtime composite factory instead — **0 `.prefab` files shipped**. Real prefab assets land in D.U9b.

**Goal:** Each weapon visually distinct via runtime composite primitives + hue applied at runtime from `weapon.visual.hue`.

**Scope shipped:**
- `WeaponPrefabRegistry.cs` — static switch-case factory, 6 catalog slugs + `_placeholder` fallback. Returns runtime-built composite GameObject (1-3 Cube/Cylinder/Sphere primitives parented to "WeaponRoot").
- `WeaponHueApplier.cs` — hex string → MaterialPropertyBlock tint across all child MeshRenderers (`_BaseColor` + `_Color` for URP/legacy compat).
- `PlayerVisual.cs` extension — track `LockedWeapon.Slug` change, destroy old `_weaponGo`, spawn new via Registry at `(0, 1.2, 0)` local, apply hue.
- Anticipation pulse (D.U7b) — **NOT shipped**, deferred to D.U9b.

**DoD:** ✅ Smoke probes pass (7/7 catalog renderer counts), Bill visual sign-off via slug cycle on green capsule.

---

## 🛠️ Lát D.U9b — Weapon + Map polish (real prefabs + position + map)

**Goal:** (a) Migrate weapons to **real `.prefab` assets** (fixes D.U9 misnomer), (b) refine weapon position/rotation, (c) ship D.U7b anticipation pulse, (d) lift map from placeholder dark-slate to atmospheric arena.

**Scope:**

### Weapon prefabs (real `.prefab` files)
- Create `Assets/RadiantArena/Prefabs/Weapons/` folder.
- 7 `.prefab` files: 6 catalog + `_placeholder`. Each is the current composite primitive structure but saved as Project asset for designer-friendly editing.
- Migrate `WeaponPrefabRegistry.Spawn(slug)` from switch-case → `Resources.Load<GameObject>("Weapons/" + slug)` or `WeaponDatabase` ScriptableObject lookup.
- Keep `Resources/Weapons/` path or asmdef-friendly equivalent.
- Preserve current MaterialPropertyBlock-based hue path (no per-prefab material instances).

### Weapon position polish
- Lateral offset: weapon held to the side of capsule (e.g., `(0.6, 0.5, 0)` local) instead of directly above.
- Aim-facing rotation: weapon rotates `_weaponGo.transform` based on `ArenaAimController` aim direction (or `OpponentVisual` lookat for non-active turn).
- Tune per-weapon offset/rotation overrides if needed (e.g., staff held horizontal vs sword angled).

### Anticipation pulse (D.U7b unblock)
- On `MyTurnState.OnShotReleased` *before* `GoTo<AnimatingState>`, scale `_weaponGo.transform.localScale` from 1.0 → 1.15 over 80ms via `BillTween`.
- Snap back to 1.0 on AnimatingState.Exit.

### Map polish
- Ground material: replace plain dark slate with subtle hex grid texture or 2-tone gradient (still placeholder, leave HLSL `GroundCellShade` for D.U11).
- Wall details: edge trim or slightly raised border profile.
- Ambient lighting: add Directional Light + ambient color tune (current scene uses Unity defaults, walls look flat).
- Scene decoration (optional): corner stones / ground rune circle / faint atmospheric particle.

**Out of scope:**
- HLSL shaders (HueShift, WeaponEnergyHalo, GroundCellShade, etc.) — D.U11.
- Real FBX models from artist — chưa có asset, defer until artist drop.
- Particle/trail FX — D.U11 shader work.
- Tier-specific weapon polish (gold for Thiên, rainbow for Bản mệnh) — D.U11.

**DoD:** Bill visual sign-off — weapons render as real `.prefab` instances (verify via inspector), position feels "held" not "floating above", anticipation pulse visible on shot release, map no longer feels like placeholder cube room.

---

## 🎨 Lát D.U10 — UI fantasy polish

**Goal:** Lift placeholder dark-glass UI (lobby.uss / hud.uss / etc.) into a tu-tiên/cultivation-themed feel that matches the bot's narrative voice.

**Scope:**
- Vietnamese-friendly serif/calligraphic font (Google Fonts: e.g., `Cinzel`, `Cormorant`, or Vietnamese-compatible alternative). Import as `.ttf` → TextMeshPro-style asset for UI Toolkit.
- Tier color coding per weapon: Phẩm (slate), Địa (bronze), Thiên (gold), Tiên (cyan), Bản mệnh (rainbow gradient).
- Ink-wash texture overlay on panel backgrounds (single shared PNG, ~256×256 tileable).
- Replace numeric damage labels (D.U7a `damage_number.uss`) with dramatic outline + drop-shadow + larger crit pulse.
- ResultPanel banner: brush-stroke underline + ink-wash card background.
- HUD weapon name with tier color accent.

**Out of scope:**
- Full localization (Vietnamese static strings throughout — already mostly there from D.U3+).
- Audio fonts/SFX cues (D.U7b).
- HLSL shader effects (D.U11 — `DamageNumberShader.shader` etc.).

**DoD:** Bill subjective "feels like a martial-arts cultivation game" sign-off. Specific A/B checks: lobby weapon list shows tier colors, HUD shows tier accent under weapon name, ResultPanel banner reads dramatic, damage numbers feel "weighty" not generic.

---

## ✨ Lát D.U11 — HLSL shaders (10 listed)

**Goal:** Stylize cartoon visual direction locked in. See `Docs/RADIANT_ARENA_UNITY.md` §11 for full list.

**Scope (10 shaders):**
1. `CartoonLit.shader` — step-shaded base (3 bands), rim light, hue-shift uniform.
2. `OutlineFresnel.shader` — inverted-hull or screen-space outline pass.
3. `TrajectoryArc.shader` — dashed UV scrolling for aim line + projectile trail.
4. `HueShift.shader` — runtime hue rotation for weapon.visual.hue.
5. `ImpactFlash.shader` — screen-space flash on hit/crit.
6. `InkParticle.shader` — soft mask + noise for wall bounce / hit FX.
7. `GroundCellShade.shader` — 2-tone gradient floor with hex pattern.
8. `WeaponEnergyHalo.shader` — animated noise aura for thiên/tiên-tier weapons.
9. `DamageNumberShader.shader` — outline + drop shadow + size pulse.
10. `VictoryBeam.shader` — soft cone for end-state.

**Note:** Bill dev sau. Khi yêu cầu, agent implements 1 shader / Lát, không hết một lượt.

**DoD per shader:** Renders correctly in URP Sample Scene (sphere + spotlight). Multi-compile keywords correct. Properties block exposes tunables for artist.

---

## 🚀 Lát D.U12 — WebGL build + Cloudflare Pages deploy · LAST phase

> **Order rule (Bill 2026-05-18):** deploy is the **final** numbered Lát. All client content + polish + shaders ship before any public URL goes live.

**Goal:** `arena.billthedev.com/?room=X&t=Y` loads + plays.

**Scope:**
- Build Settings → WebGL → Brotli compression + Speed optimization + Strip Engine Code.
- Memory size 256MB (tune if OOM).
- HTML template add OG meta tags.
- `wrangler pages publish` to Cloudflare Pages.
- DNS A-record `arena.billthedev.com` → Pages project.
- Test from local browser with real prod tokens.

**DoD:** Public URL plays game. Discord-pasted URL shows OG card. Bot's DM contains correct URL format.

---

## 🧪 Optional Lát D.U13 — Replay viewer

**Goal:** Standalone page (or same Unity build with replay mode) plays back trajectory blob from server's replay endpoint.

**Scope:**
- `ReplayState.cs` — load trajectory blob from URL (`?replay=<session_id>`).
- Skip lobby/countdown phases, just play trajectories one after another.
- No input panel, no Colyseus connection.

**DoD:** Click replay link in #arena Discord channel → opens browser → match plays back without interaction.

---

## 🎯 Optional Lát D.U14 — PvE mode

**Goal:** Solo player vs AI opponent using same DuelRoom infrastructure but with bot-controlled second player.

**Scope:**
- Server side (`arena-server`) supports `ai_opponent: true` in create-room body.
- AI behavior tree: aim at player position + small randomness, fire when turn.
- Client side identical — sees AI as if it were another player.

**DoD:** Bot's `/arena practice` slash creates AI duel. Player can play solo.

---

## 📋 Cross-Lát checklist

After each Lát:

- [ ] Unity Console clean (no errors, no new warnings).
- [ ] Unity Test Runner EditMode + PlayMode green.
- [ ] **Double-test smoke**: 2 Editor instances via ParrelSync OR Editor + WebGL preview build successfully play the new feature.
- [ ] Doc updated if contract changed.
- [ ] Commit: `feat(arena-unity/Lát-D.U<n>): <verb> <object>`.

---

## 🔗 References

- `SKILL.md` — agent persona (Sonnet target)
- `README.md` — quickstart + how to setup Unity project
- `Docs/RADIANT_ARENA_UNITY.md` — implementation guide với scene hierarchy + code skeletons
- `Docs/BILLGAMECORE_API.md` — Bill.X API reference
- `Docs/RADIANT_ARENA_ARCHITECTURE.md` — full architecture
- `Docs/RADIANT_ARENA_COLYSEUS.md` — server contract
