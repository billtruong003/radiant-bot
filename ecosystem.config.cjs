/**
 * PM2 ecosystem config for production. Use `pm2 start ecosystem.config.cjs`
 * to launch + `pm2 save && pm2 startup` to persist across VM reboots.
 *
 * Discord bots are single-instance by design (one gateway connection per
 * token), so we set `instances: 1` and `exec_mode: 'fork'`.
 */
module.exports = {
  apps: [
    {
      name: 'radiant-tech-sect-bot',
      script: './dist/index.js',
      cwd: __dirname,

      // Single gateway, no cluster.
      instances: 1,
      exec_mode: 'fork',

      // Restart on crash; backoff if it keeps failing.
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 5000,

      // Memory ceiling — restart if it leaks past this.
      max_memory_restart: '500M',

      // No watch in prod — deploys are explicit `git pull && pm2 restart`.
      watch: false,

      // Logs roll into ./logs/. PM2 also rotates them via the
      // `pm2 install pm2-logrotate` module (see DEPLOY.md).
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true, // timestamp each log line

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
