#!/bin/zsh
cd -- "${0:A:h}"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo '需要安装 Node.js 22 或更新版本。'
  read -k 1
  exit 1
fi
open 'http://localhost:4317'
node server.mjs
read -k 1
