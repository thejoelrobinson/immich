#!/bin/bash
# ONLYOFFICE initialization script
# - Increases file size limits from 100MB to 500MB
# - Installs custom corporate fonts (Bogle, EverydaySans)
# This script runs in background at container startup

CONFIG_FILE="/etc/onlyoffice/documentserver/default.json"
CUSTOM_FONTS_DIR="/custom-fonts"
FONTS_DEST="/usr/share/fonts/truetype/custom"
FONTS_MARKER="/var/lib/onlyoffice/.fonts-installed"

# Wait for default.json to exist (created during ONLYOFFICE startup)
echo "[ONLYOFFICE-INIT] Waiting for config file..."
while [ ! -f "$CONFIG_FILE" ]; do
    sleep 2
done

# Wait a bit more for the file to be fully written
sleep 5

# ============================================
# PART 1: File Size Limits
# ============================================
if grep -q '"limits_tempfile_upload": 524288000' "$CONFIG_FILE"; then
    echo "[ONLYOFFICE-INIT] File size limits already set to 500MB"
else
    echo "[ONLYOFFICE-INIT] Updating file size limits..."
    sed -i 's/"limits_tempfile_upload": 104857600/"limits_tempfile_upload": 524288000/' "$CONFIG_FILE"
    sed -i 's/"maxDownloadBytes": 104857600/"maxDownloadBytes": 524288000/' "$CONFIG_FILE"

    if grep -q '"limits_tempfile_upload": 524288000' "$CONFIG_FILE"; then
        echo "[ONLYOFFICE-INIT] File size limits updated to 500MB"
    else
        echo "[ONLYOFFICE-INIT] ERROR: Failed to update config file"
    fi
fi

# ============================================
# PART 2: Custom Fonts Installation
# ============================================
if [ -d "$CUSTOM_FONTS_DIR" ] && [ "$(ls -A $CUSTOM_FONTS_DIR 2>/dev/null)" ]; then
    # Check if fonts were already installed (marker file exists with same font count)
    FONT_COUNT=$(find "$CUSTOM_FONTS_DIR" -type f \( -name "*.otf" -o -name "*.ttf" \) | wc -l)

    if [ -f "$FONTS_MARKER" ] && [ "$(cat $FONTS_MARKER)" = "$FONT_COUNT" ]; then
        echo "[ONLYOFFICE-INIT] Custom fonts already installed ($FONT_COUNT fonts)"
    else
        echo "[ONLYOFFICE-INIT] Installing $FONT_COUNT custom fonts..."

        # Create destination directory
        mkdir -p "$FONTS_DEST"

        # Copy font files
        cp "$CUSTOM_FONTS_DIR"/*.otf "$FONTS_DEST/" 2>/dev/null || true
        cp "$CUSTOM_FONTS_DIR"/*.ttf "$FONTS_DEST/" 2>/dev/null || true

        # Update system font cache
        echo "[ONLYOFFICE-INIT] Updating system font cache..."
        fc-cache -f -v "$FONTS_DEST" > /dev/null 2>&1

        # Regenerate ONLYOFFICE font list (this takes a while)
        echo "[ONLYOFFICE-INIT] Regenerating ONLYOFFICE font list (this may take 1-2 minutes)..."
        /usr/bin/documentserver-generate-allfonts.sh > /dev/null 2>&1

        # Mark fonts as installed
        echo "$FONT_COUNT" > "$FONTS_MARKER"

        echo "[ONLYOFFICE-INIT] Custom fonts installed: Bogle, EverydaySans"
    fi
else
    echo "[ONLYOFFICE-INIT] No custom fonts directory found, skipping font installation"
fi

# ============================================
# PART 3: Restart services to apply all changes
# ============================================
echo "[ONLYOFFICE-INIT] Restarting document server to apply changes..."
supervisorctl restart ds:converter 2>/dev/null || true

echo "[ONLYOFFICE-INIT] Configuration complete!"
