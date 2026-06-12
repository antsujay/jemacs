#!/bin/sh
# Fetch bundled webfonts into src/web/fonts/. Idempotent — skips existing files.
# Licenses: JetBrains Mono (Apache-2.0), Inter (SIL OFL 1.1). Both permit
# bundling/redistribution; LICENSE files are fetched alongside.
set -eu
out="$(dirname "$0")/../src/web/fonts"
mkdir -p "$out"

fetch() {
  dest="$out/$1"; url="$2"
  [ -s "$dest" ] && { echo "exists: $1"; return; }
  echo "fetch:  $1"
  curl -fsSL "$url" -o "$dest"
}

JBM=https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/webfonts
fetch JetBrainsMono-Regular.woff2 "$JBM/JetBrainsMono-Regular.woff2"
fetch JetBrainsMono-Bold.woff2    "$JBM/JetBrainsMono-Bold.woff2"
fetch JetBrainsMono-Italic.woff2  "$JBM/JetBrainsMono-Italic.woff2"
fetch JetBrainsMono-LICENSE.txt   https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/OFL.txt

INTER=https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip
if [ ! -s "$out/Inter-Regular.woff2" ]; then
  echo "fetch:  Inter (zip)"
  tmp=$(mktemp -d)
  curl -fsSL "$INTER" -o "$tmp/inter.zip"
  unzip -qj "$tmp/inter.zip" 'web/InterVariable.woff2' -d "$out" 2>/dev/null \
    || unzip -qj "$tmp/inter.zip" '*Inter-Regular.woff2' -d "$out" 2>/dev/null
  # Normalize the name renderer.css references.
  [ -f "$out/InterVariable.woff2" ] && mv "$out/InterVariable.woff2" "$out/Inter-Regular.woff2"
  unzip -qj "$tmp/inter.zip" 'LICENSE.txt' -d "$tmp" && cp "$tmp/LICENSE.txt" "$out/Inter-LICENSE.txt"
  rm -rf "$tmp"
fi

ls -la "$out"
