#!/usr/bin/env bash
# Production-минификация клиентских JS-файлов.
# Использование: ./build.sh — создаёт webapp/dist/ с минифицированными файлами.
# Требуется terser: npm install -g terser
set -e

SRC="webapp/js"
DIST="webapp/dist/js"
mkdir -p "$DIST"

for f in "$SRC"/*.js; do
  name=$(basename "$f")
  echo "Minifying $name..."
  terser "$f" --compress passes=2,drop_console=true --mangle -o "$DIST/$name"
done

# Копируем всё остальное как есть
mkdir -p webapp/dist/css
cp -r webapp/css/*.css webapp/dist/css/
cp webapp/index.html webapp/dist/
# В index.html подменяем js/ на dist/js/
sed -i 's|src="js/|src="dist/js/|g; s|href="css/|href="dist/css/|g' webapp/dist/index.html

echo "Done. Deploy webapp/dist/ instead of webapp/."
