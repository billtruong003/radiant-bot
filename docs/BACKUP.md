# Backup & Disaster Recovery

> Strategy + procedure cho việc backup state của bot + recover khi VPS chết / data corrupt / human error.

---

## 🎯 What needs backing up

State của bot persisted ở `data/`:

```
data/
├── snapshot.json      # full state dump (1h interval + on shutdown)
├── wal.jsonl          # write-ahead log (every mutation appended)
├── aki-budget.json    # daily Aki cost tracker
└── (other ad-hoc state files)
```

`snapshot.json` chứa:
- All users + XP + ranks + currencies + công pháp inventory
- Verification records
- Daily quests + completion state
- Automod logs (last N entries)
- Aki call logs (cost + filter history)
- Doc contributions + review logs
- Reaction roles config
- Raid state
- Sect events (tribulation history)

`wal.jsonl` chứa các mutation chưa được snapshot (gap < 1 hour at any time, < 5ms typically).

**Total data size** sau 6 tháng vận hành (~5K active users, ~200K xp_logs): ~50-80 MB.

---

## 🔄 Backup tiers

### Tier 1 — Nightly cloud backup (automatic)

Cron `0 0 * * *` VN trong `src/modules/scheduler/index.ts` invokes `backupToGitHub()` from `src/modules/scheduler/backup.ts`:

1. Reads current `data/snapshot.json` + `data/wal.jsonl`
2. Pushes to private GitHub repo configured via env vars:
   - `BACKUP_GITHUB_REPO=user/private-repo`
   - `BACKUP_GITHUB_TOKEN=ghp_...` (PAT with `repo` scope)
3. Commit message: `nightly snapshot YYYY-MM-DD`

**Retention**: GitHub keeps full history → unlimited rewind to any night.

**Recovery from Tier 1**:
```bash
# On a fresh VPS / replacement instance:
git clone https://<TOKEN>@github.com/user/private-repo /tmp/backup
cp /tmp/backup/snapshot.json /root/bots/radiant-bot/data/
cp /tmp/backup/wal.jsonl /root/bots/radiant-bot/data/
pm2 restart radiant-tech-sect-bot
# Bot reads snapshot + replays WAL on init → resumes
```

If `BACKUP_GITHUB_REPO` / `BACKUP_GITHUB_TOKEN` are unset, this tier is silently disabled (Tier 2 + 3 still active).

### Tier 2 — Local rolling snapshots (manual)

Take a local archive before risky operations:

```bash
cd /root/bots/radiant-bot
tar -czf data-$(date +%Y%m%d-%H%M).tar.gz data/
# Move to safe location
mv data-*.tar.gz /root/backups/
```

Schedule via crontab on VPS for redundancy:
```cron
0 */6 * * * cd /root/bots/radiant-bot && tar -czf /root/backups/snap-$(date +\%Y\%m\%d-\%H).tar.gz data/ && find /root/backups -name "snap-*.tar.gz" -mtime +7 -delete
```

This keeps 7 days × 4 snapshots/day = 28 local archives, auto-prunes older.

**Recovery from Tier 2**:
```bash
pm2 stop radiant-tech-sect-bot
cd /root/bots/radiant-bot
rm -f data/snapshot.json data/wal.jsonl
tar -xzf /root/backups/snap-20260514-12.tar.gz
pm2 start radiant-tech-sect-bot
```

### Tier 3 — WAL durability (in-process)

`WAL_FSYNC=true` (production default) — every WAL write is fsynced before returning. Crash mất tối đa 0 messages worth of mutations (last 5ms of writes).

`WAL_FSYNC=false` (dev) — batched, lose up to ~1 second of writes on crash. Acceptable in dev where no real users at risk.

This is the "last mile" defense — even if Tier 1 + 2 fail, the WAL on disk is intact unless the disk itself is destroyed.

---

## ⚠️ Disaster scenarios + recovery

### Scenario A: Bot crashes mid-message-burst

**Symptom**: PM2 restarts bot automatically. Logs show `uncaught exception` followed by `store: ready`.

**Data state**: Snapshot from last hour + all WAL entries since. Replay applies WAL on top. **Zero data loss** beyond the last few ms.

**Action**: None. Auto-recovered. Verify via `/stats` that recent activity (last hour) still present.

### Scenario B: Snapshot file corrupted

**Symptom**: Logs show `store: snapshot read failed, ignoring (will rebuild from WAL)`.

**Action**: Bot keeps running with only WAL state (anything since the last good snapshot). Old user data + history may be missing.

**Recovery**:
1. Restore previous good snapshot from Tier 1 (GitHub) or Tier 2 (local archive):
   ```bash
   pm2 stop radiant-tech-sect-bot
   cp /root/backups/snap-LATEST_KNOWN_GOOD.tar.gz /tmp/
   cd /root/bots/radiant-bot && rm data/snapshot.json && tar -xzf /tmp/snap-LATEST_KNOWN_GOOD.tar.gz data/snapshot.json
   pm2 start radiant-tech-sect-bot
   ```
2. WAL keeps post-corruption mutations and will replay on top.

### Scenario C: Entire `data/` directory deleted

**Symptom**: Bot starts with `store: no snapshot, fresh start` — empty state.

**Action**:
1. Stop bot immediately to avoid writing fresh empty state.
2. Restore full `data/` from Tier 1:
   ```bash
   pm2 stop radiant-tech-sect-bot
   git clone https://<TOKEN>@github.com/user/private-repo /tmp/backup
   cp -r /tmp/backup/data /root/bots/radiant-bot/
   pm2 start radiant-tech-sect-bot
   ```
3. Loss: anything since the last nightly GitHub backup (~24h max).

### Scenario D: VPS dies / migrate to new VPS

**Action**:
1. Provision new VPS following [`docs/SETUP.md`](SETUP.md) §1-§4.
2. Restore `data/` from GitHub (Tier 1) — same as Scenario C.
3. Update DNS / health-monitor URL if any.

Recovery time: ~30 minutes for full re-provision + restore.

### Scenario E: Human error (admin granted wrong currency, mistaken rank promote)

**Action**:
1. Take local archive immediately (Tier 2) to preserve current state as "after error" snapshot for diff:
   ```bash
   tar -czf /root/backups/error-$(date +%Y%m%d-%H%M).tar.gz data/
   ```
2. Restore previous good local archive OR git-checkout previous nightly:
   ```bash
   git -C /tmp/backup log --oneline | head -5
   git -C /tmp/backup checkout <hash> -- snapshot.json wal.jsonl
   pm2 stop radiant-tech-sect-bot
   cp /tmp/backup/snapshot.json /root/bots/radiant-bot/data/
   cp /tmp/backup/wal.jsonl /root/bots/radiant-bot/data/
   pm2 start radiant-tech-sect-bot
   ```
3. Communicate to users — anyone XP earned in the rollback window will lose it. Compensate via `/grant` if material.

### Scenario F: Database growth runaway

WAL keeps appending until snapshot truncates. If snapshot fails repeatedly, WAL can grow indefinitely.

**Symptom**: `data/wal.jsonl` > 500MB.

**Action**:
1. Check pino logs for `store: scheduled snapshot failed` entries — diagnose root cause (disk full? perm error? fs lock?).
2. Force a manual snapshot via SIGTERM (graceful shutdown takes a final snapshot):
   ```bash
   pm2 stop radiant-tech-sect-bot --signal SIGTERM
   ls -lh /root/bots/radiant-bot/data/  # WAL should now be truncated
   pm2 start radiant-tech-sect-bot
   ```

---

## ✅ Recovery testing procedure

Quarterly drill — verify backups actually work:

1. Create disposable Discord test server with same role/channel structure.
2. Configure bot with TEST env vars pointing at test server.
3. Pull production backup from GitHub.
4. Run bot against test server with the backup data.
5. Verify: `/stats`, `/rank` for a few sample users, `/leaderboard` — data matches expected production snapshot.
6. Spot-check: random user's pills + contribution match what they had in production.
7. Document drill outcome in `docs/recovery-drill-YYYY-Q.md`.

---

## 🚫 What's NOT backed up

- `.env` (secrets) — Bill stores separately (password manager / encrypted notes).
- `node_modules/` (rebuildable via `npm install`).
- `dist/` (rebuildable via `npm run build`).
- Pino logs (transient — saved by PM2's log rotation, kept 7 days).
- Aki Grok cost cache (recomputable from `akiLogs` collection in snapshot).

---

## 🔑 Backup key management

- `BACKUP_GITHUB_TOKEN` lives in `.env` on VPS only. Never committed.
- Token scope: `repo` (private repo write). Nothing else.
- Rotation: every 6 months, regenerate PAT on GitHub, update `.env`, `pm2 restart`.
- If token leaks: revoke immediately on GitHub. Set new token in `.env`. Rotate.

---

## 📊 Backup health monitoring

Health check endpoint `/health` exposes store stats:

```json
{
  "status": "ok",
  "store": {
    "users": 245,
    "xp_logs": 47891,
    "snapshot_path": "data/snapshot.json"
  }
}
```

If `users` or `xp_logs` drops unexpectedly, investigate snapshot read errors in logs.

Optional: configure UptimeRobot to alert when:
- `/health` returns 503 (Discord not ready)
- `/health` returns 200 BUT `store.users` < a threshold (data loss signal)

---

## 🆘 Emergency contact

- **Bill Truong** (billtruong003@gmail.com) — project lead.
- **GitHub Issues** — non-emergency bug reports.

For production-down emergencies: SSH to VPS, follow Scenario A-D above.
