#!/bin/bash
# setup-gce.sh
# Run this script securely on your newly created Debian/Ubuntu Compute Engine VM.

# Exit on first error
set -e

echo "Starting Compute Engine Provisioning for AgencyOS..."

# 1. Update OS and Install build dependencies
echo "Updating OS packages..."
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl git build-essential nginx ufw

# 2. Install Node.js (v20)
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# 3. Install PM2 (Process Manager) globally
echo "Installing PM2..."
sudo npm install -g pm2

# 4. Configure Firewall (ufw)
echo "Configuring firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# 5. Set up Project Directory
echo "Configuring project directory structure..."
mkdir -p /home/$USER/agencyos
cd /home/$USER/agencyos

echo "--------------------------------------------------------"
echo "✅ Provisioning Complete!"
echo "Next Steps:"
echo "1. Clone your repository into /home/$USER/agencyos"
echo "2. Add your .env.local via echo or Secret Manager"
echo "3. Run: npm ci && npm run build"
echo "4. Run: pm2 start ecosystem.config.cjs"
echo "5. PM2 Startup config: Run 'pm2 startup' and follow prompts"
echo "--------------------------------------------------------"
