// PM2 进程配置 — 在项目根目录执行: pm2 start deploy/ecosystem.config.cjs
// 服务只监听 127.0.0.1,由 Nginx 反代对外;TYPESAFE_API_KEY 不在此处,读项目根 .env.local
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'triad',
      script: 'server.mjs',
      cwd: path.join(__dirname, '..'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '4317',
        TRUST_PROXY: '1',        // 仅在 Nginx 反代后开启
        PUBLIC_DAILY_LIMIT: '23', // 公共终端每 IP 每日配额
      },
    },
  ],
};
