#!/bin/bash
set -e

# Update homebrew formula with sha256 hashes from GitHub release
# Usage: ./scripts/update-formula.sh 0.1.0

VERSION=$1
FORMULA="/opt/homebrew/Library/Taps/bwl/homebrew-ettio/Formula/karl.rb"
REPO="bwl/karl"

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/update-formula.sh <version>"
  echo "Example: ./scripts/update-formula.sh 0.1.0"
  exit 1
fi

TAG="v$VERSION"
BASE_URL="https://github.com/$REPO/releases/download/$TAG"

echo "Updating karl formula to $VERSION"
echo ""

# Check if release exists
echo "Checking release $TAG exists..."
if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Error: Release $TAG not found. Did the GitHub Action complete?"
  echo "Check: https://github.com/$REPO/actions"
  exit 1
fi

# Download and hash each binary
echo "Downloading binaries and calculating sha256..."
echo ""

DARWIN_ARM64=$(curl -sL "$BASE_URL/karl-darwin-arm64" | shasum -a 256 | cut -d' ' -f1)
echo "darwin-arm64: $DARWIN_ARM64"

LINUX_X64=$(curl -sL "$BASE_URL/karl-linux-x64" | shasum -a 256 | cut -d' ' -f1)
echo "linux-x64:    $LINUX_X64"

echo ""

# Update formula
echo "Updating $FORMULA..."

# Update version
sed -i '' "s/version \".*\"/version \"$VERSION\"/" "$FORMULA"

# Update sha256 hashes (handle both placeholders and existing hashes)
# macOS section comes first, then Linux
perl -i -pe "
  if (/on_macos/) { \$in_macos = 1 }
  if (/on_linux/) { \$in_macos = 0; \$in_linux = 1 }
  if (\$in_macos && /sha256/) { s/sha256 \"[^\"]+\"/sha256 \"$DARWIN_ARM64\"/; \$in_macos = 0 }
  if (\$in_linux && /sha256/) { s/sha256 \"[^\"]+\"/sha256 \"$LINUX_X64\"/; \$in_linux = 0 }
" "$FORMULA"

echo "✓ Formula updated"
echo ""

# Commit and push
echo "Committing to homebrew-ettio..."
cd /opt/homebrew/Library/Taps/bwl/homebrew-ettio
git add Formula/karl.rb
git commit -m "karl $VERSION"
git push origin main

echo ""
echo "✓ Formula pushed to homebrew-ettio"
echo ""
echo "Users can now install with:"
echo "  brew tap bwl/ettio"
echo "  brew install karl"
echo ""
echo "Or upgrade with:"
echo "  brew upgrade karl"
