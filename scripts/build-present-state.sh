#!/bin/bash
# Build the Karl Present State Report
# Concatenates OVERVIEW.md and all status documents into one comprehensive file

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${SCRIPT_DIR}/../status"
OUTPUT_FILE="${SCRIPT_DIR}/../megamerge_docs/PRESENT_STATE.md"

# Ensure output directory exists
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Header
cat > "$OUTPUT_FILE" << 'EOF'
# Karl Present State Report

> A comprehensive inventory of Karl's current architecture, capabilities, developer experience, and technical status.

**Generated:** $(date)

---

EOF

# Add timestamp
sed -i '' "s/\$(date)/$(date '+%Y-%m-%d %H:%M:%S')/" "$OUTPUT_FILE"

echo "Building Karl Present State Report..."

# Start with the overview
echo "  Adding OVERVIEW.md..."
echo "" >> "$OUTPUT_FILE"
echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
cat "$SOURCE_DIR/OVERVIEW.md" >> "$OUTPUT_FILE"

# Define the order of documents (grouped by category)
DOCS=(
    # Project Overview
    "PROJECT_SUMMARY.md"

    # Architecture
    "CLI_ARCHITECTURE.md"
    "CLI_COMMANDS.md"
    "CONFIGURATION_SYSTEM.md"
    "EXTENSIBILITY.md"

    # Developer Experience & Branding
    "DEVELOPER_EXPERIENCE.md"
    "BRANDING_AUDIT.md"

    # Build & Quality
    "BUILD_AND_DEPLOYMENT.md"
    "CODE_QUALITY.md"
    "TECHNICAL_DEBT.md"
)

# Append each document with a separator
for doc in "${DOCS[@]}"; do
    if [[ -f "$SOURCE_DIR/$doc" ]]; then
        echo "  Adding $doc..."
        echo "" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        echo "---" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        echo "<!-- BEGIN: $doc -->" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        cat "$SOURCE_DIR/$doc" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        echo "<!-- END: $doc -->" >> "$OUTPUT_FILE"
    else
        echo "  Warning: $doc not found, skipping..."
    fi
done

# Calculate stats
TOTAL_LINES=$(wc -l < "$OUTPUT_FILE")
TOTAL_BYTES=$(wc -c < "$OUTPUT_FILE")
TOTAL_KB=$((TOTAL_BYTES / 1024))

echo ""
echo "Present State Report built successfully!"
echo "  Output: $OUTPUT_FILE"
echo "  Size: ${TOTAL_KB}KB (${TOTAL_LINES} lines)"
echo ""
echo "🎾 Ace!"
