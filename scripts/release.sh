#!/bin/bash
set -e

# Release script for karl
# Usage: ./scripts/release.sh 0.1.0

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 0.1.0"
  exit 1
fi

# Validate version format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must be in format X.Y.Z (e.g., 0.1.0)"
  exit 1
fi

TAG="v$VERSION"

echo "Releasing karl $TAG"
echo ""

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --staged --quiet; then
  echo "Error: You have uncommitted changes. Commit or stash them first."
  exit 1
fi

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists"
  exit 1
fi

# Create and push tag
echo "Creating tag $TAG..."
git tag "$TAG"

echo "Pushing tag to origin..."
git push origin "$TAG"

echo ""
echo "✓ Tag $TAG pushed to origin"
echo ""
echo "GitHub Actions will now build the binaries."
echo "Watch progress at: https://github.com/bwl/karl/actions"
echo ""
echo "Once complete, run:"
echo "  ./scripts/update-formula.sh $VERSION"
