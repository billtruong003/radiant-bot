# Deployment guide — Radiant Tech Sect Bot

Production deploy on Oracle Cloud Always Free Tier (ARM Ampere A1 Flex).
Single-VM, single-instance — Discord bots can't be horizontally
clustered (one gateway connection per token).

---

## 1. Provision the VM

In Oracle Cloud Console:
- Create **Ampere A1 Flex** instance (Always Free)
- Shape: 2 OCPU, 12 GB RAM (free tier max — overkill but free)
- Image: **Ubuntu 22.04 LTS**
- Networking: VCN default, **add ingress rule for TCP 3030** on the
  health-check security list (for UptimeRobot) — restrict to
  UptimeRobot's IPs if you want zero public exposure.
- Generate SSH keypair, save private key.

Note the public IP — you'll need it for SSH + UptimeRobot config.

---

## 2. Initial VM setup (one-time)

SSH in:
```bash
ssh -i ~/.ssh/oracle-key.pem ubuntu@<PUBLIC_IP>
```

System update + Node 20 + canvas deps + build tools:
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential git \
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

# Verify
node --version   # v20.x
npm --version    # 10.x

# PM2 (global)
sudo npm install -g pm2
pm2 install pm2-logrotate  # log rotation
```

Open the health port in the OS firewall (matches the security list rule above):
```bash
sudo iptables -I INPUT -p tcp --dport 3030 -j ACCEPT
sudo netfilter-persistent save
```

---

## 3. Deploy the bot

Clone + install:
```bash
mkdir -p ~/bots && cd ~/bots
git clone https://github.com/<your-user>/<your-repo>.git radiant-bot
cd radiant-bot

npm ci
npm run build
```

Create `.env` (NEVER commit this):
```bash
nano .env
```
Paste:
```
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=1503973391579742278
DISCORD_GUILD_ID=...

NODE_ENV=production
LOG_LEVEL=info
DATA_DIR=./data
SNAPSHOT_INTERVAL_MS=3600000
WAL_FSYNC=true

ADMIN_USER_IDS=350863712208289792

# GitHub backup (private repo + PAT scope: repo)
BACKUP_GITHUB_REPO=billtruong003/radiant-bot-backup
BACKUP_GITHUB_TOKEN=ghp_...

# Health-check endpoint for UptimeRobot
HEALTH_PORT=3030
```

Pre-deploy: restore from latest backup if migrating:
```bash
mkdir -p data backup-repo
git clone https://${BACKUP_GITHUB_TOKEN}@github.com/${BACKUP_GITHUB_REPO}.git backup-repo
cp backup-repo/snapshot.json data/snapshot.json
cp backup-repo/wal.jsonl data/wal.jsonl
```

Start under PM2:
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup       # follow the sudo command it prints to enable auto-resume on reboot
```

Verify:
```bash
pm2 logs radiant-tech-sect-bot --lines 50
curl http://localhost:3030/health
```

Expected health response:
```json
{
  "status": "ok",
  "uptime_ms": 12345,
  "discord": { "ready": true, "ping_ms": 45, "guilds": 1 },
  "store": { "users": 5, "xp_logs": 189, "snapshot_path": "./data/snapshot.json" }
}
```

---

## 4. UptimeRobot

- Sign up at https://uptimerobot.com (free tier: 50 monitors).
- Create monitor:
  - Type: **HTTP(s)**
  - URL: `http://<PUBLIC_IP>:3030/health`
  - Interval: 5 min
  - Alert: notify your email / Discord webhook if down ≥ 5 min.

---

## 5. Updates (deploy a new version)

From local:
```bash
git push
```

On the VM:
```bash
cd ~/bots/radiant-bot
git pull
npm ci
npm run build
pm2 restart radiant-tech-sect-bot
pm2 logs radiant-tech-sect-bot --lines 30
```

WAL + snapshot survive — restart is non-destructive.

---

## 6. Slash command deploys

When command files change (rare after Phase 4-7), re-register:
```bash
npm run deploy-commands         # guild-scoped, instant
# OR
npm run deploy-commands:global  # global, ~1h propagation
```

---

## 7. Recovery scenario (VM lost)

If the Oracle VM dies hard:

1. **Provision a fresh VM** (steps 1-2 above).
2. **Clone repo + install** (step 3 — first half, before `.env`).
3. **Restore data from backup** (the backup cron pushed to GitHub
   daily 00:00 VN):
   ```bash
   mkdir -p data
   git clone https://<TOKEN>@github.com/<BACKUP_REPO>.git backup-repo
   cp backup-repo/snapshot.json data/snapshot.json
   cp backup-repo/wal.jsonl data/wal.jsonl 2>/dev/null || true
   ```
4. **Configure `.env`** with same `DISCORD_TOKEN`, `DATA_DIR`,
   `BACKUP_GITHUB_*` as before.
5. **Start under PM2** + verify health.
6. The bot replays WAL on top of the snapshot — all state up to the
   last snapshot is recovered. Lost data: ≤ 24h of XP between last
   backup push and crash.

---

## 8. Common operations

### Tail logs
```bash
pm2 logs radiant-tech-sect-bot
pm2 logs radiant-tech-sect-bot --err --lines 100   # errors only
```

### Restart / stop
```bash
pm2 restart radiant-tech-sect-bot
pm2 stop radiant-tech-sect-bot
pm2 delete radiant-tech-sect-bot   # remove from PM2 entirely
```

### Memory check
```bash
pm2 monit   # live dashboard
```

### Trigger a backup manually (e.g., before risky migration)
```bash
# CLI doesn't expose this directly — restart the bot at 00:00 VN
# OR
node --eval "import('./dist/modules/scheduler/backup.js').then(m => m.backupToGitHub())"
```

### Inspect the store on disk
```bash
ls -lh data/
# snapshot.json (latest full state)
# wal.jsonl (changes since last snapshot)
```

---

## 9. Initial public-launch checklist

After deploy + health green, do these in order:

```bash
# 1. Sync server schema (idempotent — only runs if drift)
npm run check-server                            # PASS expected
npm run sync-server                             # apply if check failed

# 2. One-time bulk onboard existing members (skips verification)
npm run bot -- bulk-onboard --apply

# 3. Deploy slash commands
npm run deploy-commands

# 4. Pin channel guides
npm run bot -- pin-channel-guides

# 5. Setup reaction-roles message
npm run bot -- setup-reaction-roles

# 6. Apply role icons (only if Boost Level ≥ 2)
npm run bot -- upload-role-icons

# 7. THE BIG GREEN BUTTON — public launch announcement
npm run bot -- post-launch-announcement
```

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Bot starts then exits immediately | bad `.env` (missing token) | check `.env`, re-set `DISCORD_TOKEN` |
| `/health` returns 503 | Discord gateway not connected | check token validity, network, ratelimit |
| `npm ci` fails on canvas | missing native libs | re-run `apt install` from step 2 |
| PM2 doesn't restart on reboot | `pm2 startup` not configured | re-run + execute the sudo command it prints |
| Health port unreachable from internet | OS firewall or VCN security list | check `iptables -L`, VCN ingress rules |
| Backup commits failing | invalid PAT or repo deleted | regenerate PAT, update `.env`, restart |
| WAL replay warns "shape-invalid op" | partial write at crash | warning is benign; data integrity preserved |
| Bot can't assign roles | bot role below target role in hierarchy | drag bot role above target in Server Settings |

---

## 11. Stress testing

After deploy, before flipping public:

```bash
# Simulate 100 messages/min for 5 min from 5 alts.
# (manual — use 5 Discord accounts, paste into a channel)

# Check that XP tracking didn't drop messages:
# 1. Each alt should have last_message_at updated
# 2. xp_logs should show entries with cooldown enforced (60s gap minimum)
```

Watch `pm2 monit` during the burst — memory should stay flat (<200MB),
CPU spikes are OK.

---

## 12. Rolling back

If a deploy breaks something:

```bash
cd ~/bots/radiant-bot
git log --oneline -10                # find the last good commit
git checkout <last-good-sha>
npm ci && npm run build
pm2 restart radiant-tech-sect-bot
```

Backed-up data is forward-compatible (snapshot version is checked at
load); if schema changes, you'll see a warn log + fresh-start fallback.
