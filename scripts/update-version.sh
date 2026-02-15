#!/bin/bash
# Update version in package.json using git short hash or timestamp
cd "$(dirname "$0")/.."

VERSION=$(git rev-parse --short HEAD 2>/dev/null)
if [ -z "$VERSION" ]; then
    VERSION=$(date +%Y-%m-%d-%H-%M-%S)
fi

# Update version in package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "Version updated to: $VERSION"
