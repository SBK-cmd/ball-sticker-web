#!/usr/bin/env python3
"""Build the app from src/app.html.
   python3 tools/build.py preview  -> preview.html + js/p-lock.js + js/p-app.js
   python3 tools/build.py live     -> index.html, ball-sticker.html + js/lock.js + js/app.js
   The big inline scripts are moved to external files (deferred, cacheable, content-hashed)."""
import sys, re, hashlib, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
target = sys.argv[1] if len(sys.argv) > 1 else 'preview'
pre = 'p-' if target == 'preview' else ''
s = open(os.path.join(ROOT, 'src/app.html'), encoding='utf-8').read()
LOCK_MARK = '<script>\n(function () {\n  // ---- คลาวด์ (Firebase)'
def take(s, start):
    end = s.index('</script>', start) + len('</script>')
    return s[start:end], s[start + len('<script>'):end - len('</script>')]
# lock script
i = s.index(LOCK_MARK); block, lock_js = take(s, i)
# main app script = largest inline script
blocks = [(m.start(), m.group(1)) for m in re.finditer(r'<script>(.*?)</script>', s, re.S)]
ai, app_js = max(blocks, key=lambda b: len(b[1]))
app_block = '<script>' + app_js + '</script>'
def out(name, code):
    h = hashlib.sha1(code.encode()).hexdigest()[:10]
    open(os.path.join(ROOT, 'js', name), 'w', encoding='utf-8').write(code)
    return 'js/%s?v=%s' % (name, h)
lock_url = out(pre + 'lock.js', lock_js); app_url = out(pre + 'app.js', app_js)
s = s.replace(app_block, '<script defer src="%s"></script>' % app_url, 1)
s = s.replace(block, '<script defer src="%s"></script>' % lock_url, 1)
s = re.sub(r'<script src="(https://www\.gstatic\.com/firebasejs/[^"]+)"></script>', r'<script defer src="\1"></script>', s)
files = ['preview.html'] if target == 'preview' else ['index.html', 'ball-sticker.html']
for f in files: open(os.path.join(ROOT, f), 'w', encoding='utf-8').write(s)
print('built', files, 'html', len(s), 'lock', len(lock_js), 'app', len(app_js))
