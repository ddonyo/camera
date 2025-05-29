#!/bin/bash

set -e

NVM_DIR="$HOME/.nvm"

if [ -s "$NVM_DIR/nvm.sh" ]; then
    echo "NVM is already installed."
    exit 1
fi

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

. "$NVM_DIR/nvm.sh"

nvm install 22

node -v

echo "Please restart the shell or run 'source ~/.nvm/nvm.sh' to apply the changes."
