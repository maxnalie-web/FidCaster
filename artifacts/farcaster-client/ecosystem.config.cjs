module.exports = {
  apps: [
    {
      name: "fidcaster-server",
      script: "server/index.ts",
      interpreter: "tsx",
      instances: 1,
      exec_mode: "fork",
      env_production: {
        NODE_ENV: "production",
        API_PORT: "3001",
      },
      max_memory_restart: "512M",
      restart_delay: 3000,
      max_restarts: 10,
      exp_backoff_restart_delay: 100,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/server-error.log",
      out_file: "logs/server-out.log",
      merge_logs: true,
    },
  ],
};
