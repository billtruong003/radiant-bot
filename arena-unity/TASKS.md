# Tasks — Radiant Arena Unity Client (Lát D.U)

> High-level Lát plan cho Unity WebGL client. Mỗi Lát ship được riêng — Bill sẽ break sub-tasks chi tiết khi vào từng Lát.
>
> **Đọc trước:** `SKILL.md`, `README.md`, `Docs/RADIANT_ARENA_UNITY.md`, `Docs/BILLGAMECORE_API.md`.
>
> **Hiện trạng:** chưa setup project Unity. Lát D.U1 = bootstrap.

---

## 🆕 Lát D.U1 — Unity project bootstrap

**Goal:** Project mở được trong Unity Hub, BillGameCore wired, GameBootstrap fires GameReadyEvent.

**Scope:**
- Unity Hub → New Project → Unity 6.0 LTS → Universal 3D template.
- Project name `radiant-arena-unity`.
- Player Settings: WebGL target, .NET Standard 2.1, resolution 1280×720.
- Install packages (Package Manager):
  - Colyseus Unity SDK (git URL: `https://github.com/colyseus/colyseus-unity-sdk.git?path=Assets/Colyseus`)
  - Cinemachine, ShaderGraph, URP, UI Toolkit (Unity registry)
  - BillGameCore (local path or git from Bill's existing repo)
  - ParrelSync (`https://github.com/VeriorPies/ParrelSync.git?path=/ParrelSync`)
- Folder layout per `Docs/RADIANT_ARENA_UNITY.md` §1.3.
- `GameBootstrap.cs` — call `await Bill.Init(config)` + register placeholder state.
- `BootState.cs` — empty `Enter`/`Exit` for now.
- Open project → Console clean → Bill.IsReady = true.

**DoD:** Project boots in Editor, `Bill.IsReady` logged true after Play.

---

## 🌐 Lát D.U2 — NetClient + Colyseus connect

**Goal:** `NetClient` is the only MonoBehaviour touching Colyseus SDK. 2 Editor instances connect to same room, both see `state.phase=lobby`.

**Scope:**
- `NetClient.cs` — `Connect(ConnectionInfo)`, `room.OnStateChange`, `room.OnLeave`.
- `NetMessageTypes.cs` — DTOs matching server messages.
- `ArenaContext.cs` — static singleton holding match snapshot + hydration.
- `ManualRoomConnect.cs` (Editor-only) — paste ws URL + token + room ID, right-click → Connect for testing.
- `BootState.cs` — parse URL query (`?room=X&t=Y`) on WebGL build.
- `ConnectingState.cs` — show ConnectingPanel, await Connect, transition to LobbyState on success.

**DoD:** Run `arena-server` locally + `npm run smoke` to get 2 tokens; paste in 2 Editor instances via ParrelSync; both join successfully.

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

## 🗡️ Lát D.U8 — Weapon prefabs (6 catalog + bản mệnh)

**Goal:** Each weapon visually distinct via prefab + hue applied at runtime from `weapon.visual.hue`.

**Scope:**
- 6 placeholder prefabs in `Prefabs/Weapons/` matching `model_prefab_key` slugs from catalog:
  - `weapon_thiet_con_01`, `weapon_chuy_01`, `weapon_kiem_01`, `weapon_thiet_phien_01`, `weapon_di_hoa_01`, `weapon_le_bang_01`.
- `_placeholder` fallback prefab (grey sphere) for unknown slugs.
- `WeaponPrefabRegistry.cs` lookup.
- `WeaponHueApplier.cs` — accept hex color string, MaterialPropertyBlock tint base color.
- `PlayerVisual.cs` — spawn correct weapon prefab on player slot during onJoin hydration.

**DoD:** Both players see distinct weapon models per slug. Bản mệnh weapons show generic prefab but with unique hue per Discord ID.

---

## 🎨 Lát D.U9 — HLSL shaders (10 listed)

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

## 🚀 Lát D.U10 — WebGL build + Cloudflare Pages deploy

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

## 🧪 Optional Lát D.U11 — Replay viewer

**Goal:** Standalone page (or same Unity build with replay mode) plays back trajectory blob from server's replay endpoint.

**Scope:**
- `ReplayState.cs` — load trajectory blob from URL (`?replay=<session_id>`).
- Skip lobby/countdown phases, just play trajectories one after another.
- No input panel, no Colyseus connection.

**DoD:** Click replay link in #arena Discord channel → opens browser → match plays back without interaction.

---

## 🎯 Optional Lát D.U12 — PvE mode

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
