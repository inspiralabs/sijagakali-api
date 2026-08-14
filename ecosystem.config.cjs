module.exports = {
  apps: [
    {
      name: "sijagakali-api",
      cwd: __dirname,
      script: "npm",
      args: "run start:api",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "sijagakali-mqtt-collector",
      cwd: __dirname,
      script: "npm",
      args: "run start:collector",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "sijagakali-data-processing",
      cwd: __dirname,
      script: "npm",
      args: "run start:processing",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "sijagakali-notification-gateway",
      cwd: __dirname,
      script: "npm",
      args: "run start:notification",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    }
  ],
};
