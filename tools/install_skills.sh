#!/usr/bin/env bash
# ติดตั้งสกิลออกแบบของโปรเจกต์ลง .claude/skills/ (โฟลเดอร์นี้ไม่ได้เก็บใน git — รันใหม่เมื่อเริ่มเครื่อง/คอนเทนเนอร์ใหม่)
#   bash tools/install_skills.sh
# taste-skill (design-taste-frontend) — github.com/Leonxlnx/taste-skill, MIT, ตรึงที่ commit ด้านล่าง
# ตัด Stop hook อัตโนมัติใน SKILL.md ออก: ตัวตรวจ gate.mjs ให้รันเองด้วยมือเมื่อใช้สกิลกับหน้าเว็บ
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIN=f6b7657
DEST="$ROOT/.claude/skills/design-taste-frontend"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone -q https://github.com/Leonxlnx/taste-skill.git "$TMP/repo"
git -C "$TMP/repo" checkout -q "$PIN"
rm -rf "$DEST"; mkdir -p "$ROOT/.claude/skills"
cp -r "$TMP/repo/skills/taste-skill" "$DEST"
cp "$TMP/repo/LICENSE" "$DEST/LICENSE"
python3 - "$DEST/SKILL.md" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf8').read()
if 'hooks:\n' in s.split('\n---\n', 1)[0]:
    a = s.index('hooks:\n'); b = s.index('\n---\n', a)
    s = s[:a].rstrip('\n') + s[b:]
    open(p, 'w', encoding='utf8').write(s)
PY
echo "installed design-taste-frontend @$PIN -> $DEST"
