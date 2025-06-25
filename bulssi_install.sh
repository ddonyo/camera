#!/bin/bash

set -e

# 필요한 툴 설치
echo "Install host tools..."
apt install -y make

# 노드 설치
echo "Install Node.js..."
./node_install.sh

source ~/.nvm/nvm.sh

echo "Install packages..."
npm install

echo "Make camera daemon..."
npm run build
