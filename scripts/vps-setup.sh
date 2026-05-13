#!/usr/bin/env bash
#
# One-shot VPS setup script for Radiant Tech Sect Bot.
# Run AS ROOT on a fresh Ubuntu 22.04 LTS VM.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/billtruong003/radiant-bot/main/scripts/vps-setup.sh | bash
#
# Or copy-paste this whole file into the VM via nano + bash vps-setup.sh
#
# After this finishes, you must:
#   1. cd ~/bots/radiant-bot && nano .env  (fill credentials)
#   2. pm2 start ecosystem.config.cjs
#   3. pm2 save && pm2 startup
#   4. (run the sudo command pm2 startup prints)
#   5. pm2 save (again, to persist post-startup)
#
# Idempotent: re-running is safe. Each section checks state first.

set -euo pipefail

# ---------- 0. Sanity ----------

if [[ "$EUID" -ne 0 ]]; then
  echo "ERROR: run as root (sudo bash $0)"
  exit 1
fi

if ! grep -q "Ubuntu 22.04" /etc/os-release 2>/dev/null; then
  echo "WARN: not Ubuntu 22.04 — script may not work as expected"
  read -p "Continue anyway? [y/N] " ans
  [[ "$ans" == "y" ]] || exit 1
fi

# ---------- 1. System update + Node 20 + canvas deps + PM2 ----------

echo ""
echo "=== [1/4] System packages + Node 20 + canvas deps + PM2 ==="
echo ""

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y

if ! command -v node >/dev/null 2>&1 || [[ "$(node --version)" != v20.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "Node $(node --version) already installed, skipping NodeSource setup"
fi

apt-get install -y \
  build-essential git curl ca-certificates \
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
else
  echo "PM2 $(pm2 --version) already installed"
fi

pm2 install pm2-logrotate 2>/dev/null || echo "pm2-logrotate already installed"

# ---------- 2. Firewall (open port 22 + 3030 for health-check) ----------

echo ""
echo "=== [2/4] Firewall ==="
echo ""

iptables -I INPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p tcp --dport 3030 -j ACCEPT 2>/dev/null || true

if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save || true
else
  apt-get install -y iptables-persistent
fi

# ---------- 3. Clone repo + build ----------

echo ""
echo "=== [3/4] Clone + build ==="
echo ""

REPO_URL="${RADIANT_REPO_URL:-https://github.com/billtruong003/radiant-bot.git}"
INSTALL_DIR="${INSTALL_DIR:-/root/bots/radiant-bot}"

mkdir -p "$(dirname "$INSTALL_DIR")"
cd "$(dirname "$INSTALL_DIR")"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "Repo exists at $INSTALL_DIR, pulling latest"
  cd "$INSTALL_DIR"
  git pull
else
  # If repo is private, set GITHUB_PAT env var before running this script:
  # GITHUB_PAT=ghp_... bash vps-setup.sh
  if [[ -n "${GITHUB_PAT:-}" ]]; then
    AUTH_URL="${REPO_URL/https:\/\//https:\/\/${GITHUB_PAT}@}"
    git clone "$AUTH_URL" "$INSTALL_DIR"
  else
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"
fi

npm ci
npm run build

mkdir -p data logs

# ---------- 4. .env template (if missing) ----------

echo ""
echo "=== [4/4] .env template ==="
echo ""

if [[ ! -f .env ]]; then
  cat > .env <<'EOF'
# Radiant Tech Sect Bot — production .env
# Edit BEFORE starting PM2.

DISCORD_TOKEN=PASTE_HERE
DISCORD_CLIENT_ID=1503973391579742278
DISCORD_GUILD_ID=PASTE_HERE

NODE_ENV=production
LOG_LEVEL=info
DATA_DIR=./data
SNAPSHOT_INTERVAL_MS=3600000
WAL_FSYNC=true

ADMIN_USER_IDS=350863712208289792

BACKUP_GITHUB_REPO=billtruong003/radiant-bot-backup
BACKUP_GITHUB_TOKEN=PASTE_HERE

HEALTH_PORT=3030
EOF
  echo ".env template created. EDIT IT before running pm2."
  echo "  cd $INSTALL_DIR && nano .env"
else
  echo ".env already exists, leaving untouched"
fi

# ---------- Done ----------

cat <<EOF


===========================================================
SETUP COMPLETE.

Next steps:
  cd $INSTALL_DIR
  nano .env                              # fill DISCORD_TOKEN, GUILD_ID, BACKUP_GITHUB_TOKEN
  pm2 start ecosystem.config.cjs
  pm2 save
  pm2 startup                            # follow the sudo command it prints
  pm2 save                               # again, after startup is set up

Verify:
  pm2 logs radiant-tech-sect-bot --lines 30
  curl http://localhost:3030/health

If /health returns {"status":"ok",...} — bot is live.
===========================================================

EOF
