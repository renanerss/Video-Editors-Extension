#!/usr/bin/env bash
# Gera releases/scroll-recorder-<versão>.zip só com o que a extensão precisa para rodar
# (sem testes, .git ou scripts). Uso: bash scripts/build-zip.sh
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')
name="scroll-recorder-$version"
out="releases/$name.zip"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

mkdir -p "$stage/scroll-recorder" releases
cp -r manifest.json background content fonts icons lib offscreen options popup ui "$stage/scroll-recorder/"
cp scripts/INSTALAR.txt "$stage/scroll-recorder/INSTALAR.txt"
rm -f "$out"
(cd "$stage" && zip -qr -X "$OLDPWD/$out" scroll-recorder)
echo "Gerado: $out ($(du -h "$out" | cut -f1))"
