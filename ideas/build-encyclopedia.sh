#!/bin/bash
# Build the Karl Ideas Encyclopedia
# Concatenates OVERVIEW.md and all idea documents into one comprehensive file

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_FILE="${SCRIPT_DIR}/ENCYCLOPEDIA.md"

# Header
cat > "$OUTPUT_FILE" << 'EOF'
# Karl Ideas Encyclopedia

> A comprehensive collection of feature explorations, design ideas, and architectural visions for Karl - the AI agent CLI named after tennis legend Ivo Karlović.

**Generated:** $(date)

---

EOF

# Add timestamp
sed -i "s/\$(date)/$(date '+%Y-%m-%d %H:%M:%S')/" "$OUTPUT_FILE"

echo "Building Karl Ideas Encyclopedia..."

# Start with the overview
echo "  Adding OVERVIEW.md..."
echo "" >> "$OUTPUT_FILE"
echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
cat "$SCRIPT_DIR/OVERVIEW.md" >> "$OUTPUT_FILE"

# Define the order of documents (grouped by category)
DOCS=(
    # Core Architecture
    "LOGGING_ARCHITECTURE.md"
    "DAEMON_MODE.md"
    "METRICS_DASHBOARD.md"
    "OFFLINE_MODE.md"

    # User Experience
    "VERBOSE_UX.md"
    "TOOL_CALL_UX.md"
    "MOODS.md"
    "SOUNDS_AND_SIGNALS.md"
    "ASCII_GRAPHICS_IDEAS.md"
    "ASCII_ART_IDENTITY.md"
    "RETRO_AESTHETICS.md"
    "DIAGRAMS.md"

    # Context & Workflows
    "CONTEXT_WITHOUT_FILES.md"
    "WORKFLOWS.md"
    "RECIPES.md"
    "CHAT_VIA_LOGGING.md"
    "LEARNING_MODE.md"
    "FEATURE_IDEAS.md"

    # Branding & Identity
    "BRANDING.md"
    "COMPETITIONS.md"

    # Integrations & Extensions
    "SHELL_INTEGRATION.md"
    "SKILL_ECOSYSTEM.md"
)

# Append each document with a separator
for doc in "${DOCS[@]}"; do
    if [[ -f "$SCRIPT_DIR/$doc" ]]; then
        echo "  Adding $doc..."
        echo "" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        echo "---" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        echo "<!-- BEGIN: $doc -->" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        cat "$SCRIPT_DIR/$doc" >> "$OUTPUT_FILE"
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
echo "Encyclopedia built successfully!"
echo "  Output: $OUTPUT_FILE"
echo "  Size: ${TOTAL_KB}KB (${TOTAL_LINES} lines)"
echo ""
echo "🎾 Ace!"
