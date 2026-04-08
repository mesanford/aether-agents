module.exports = {
  apps: [
    {
      name: 'agencyos',
      script: 'node',
      args: '--import tsx server.ts', // using tsx to run the TypeScript server directly 
      instances: 1, // Keep at 1 instance due to SQLite file-locking
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      }
    }
  ]
};
