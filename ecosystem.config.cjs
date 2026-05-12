module.exports = {
  apps: [
    {
      name: "sijagaair-api",
      cwd: __dirname,
      script: "npm",
      args: "run start:api",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "sijagaair-mqtt-collector",
      cwd: __dirname,
      script: "npm",
      args: "run start:collector",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "sijagaair-data-processing",
      cwd: __dirname,
      script: "npm",
      args: "run start:processing",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "sijagaair-notification-gateway",
      cwd: __dirname,
      script: "npm",
      args: "run start:notification",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "sijagaair-tunnel",
      script: "cloudflared",
      args: "tunnel --url http://localhost:3001",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
