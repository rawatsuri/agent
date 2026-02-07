module.exports = {
  apps: [
    {
      name: 'omnichannel-ai-api',
      script: './dist/server.js',
      instances: 'max', // Use all CPUs
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Auto restart
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      
      // Memory management
      max_memory_restart: '1G',
      
      // Watch mode (development only)
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'uploads'],
      
      // Advanced features
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,
      
      // Environment variables from .env file
      env_file: '.env',
    },
    {
      name: 'omnichannel-ai-worker',
      script: './dist/workers.bootstrap.js',
      instances: 2, // Run 2 worker instances
      exec_mode: 'fork', // Workers run in fork mode
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      log_file: './logs/worker-combined.log',
      out_file: './logs/worker-out.log',
      error_file: './logs/worker-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '512M',
      env_file: '.env',
    },
  ],
  
  // Deployment configuration
  deploy: {
    production: {
      user: 'deploy',
      host: ['your-server-ip'],
      ref: 'origin/main',
      repo: 'https://github.com/your-org/omnichannel-ai.git',
      path: '/var/www/omnichannel-ai',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'apt update && apt install -y git nodejs npm',
      'post-setup': 'ln -sf /var/www/omnichannel-ai/current /var/www/omnichannel-ai/current',
      env: {
        NODE_ENV: 'production',
      },
    },
  },
};