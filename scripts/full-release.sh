#!/bin/bash
set -e

# Full release script - tags, waits for CI, updates formula
# Usage: ./scripts/full-release.sh 0.1.0

VERSION=$1
REPO="bwl/karl"

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/full-release.sh <version>"
  echo "Example: ./scripts/full-release.sh 0.1.0"
  exit 1
fi

TAG="v$VERSION"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Step 1: Create and push tag
"$SCRIPT_DIR/release.sh" "$VERSION"

echo ""
echo "Waiting for GitHub Actions to build binaries..."
echo ""

# Step 2: Wait for the release workflow to complete
gh run watch --repo "$REPO" --exit-status || {
  echo "Error: Release workflow failed"
  echo "Check: https://github.com/$REPO/actions"
  exit 1
}

echo ""
echo "✓ Build complete"
echo ""

# Step 3: Update formula
"$SCRIPT_DIR/update-formula.sh" "$VERSION"

echo ""
echo "══════════════════════════════════════════"
echo "  karl $VERSION released!"
echo "══════════════════════════════════════════"
