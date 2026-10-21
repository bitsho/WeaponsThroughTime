#!/usr/bin/env python3
"""
Subset the Chinese web fonts to the characters the site actually uses.

  Chinese headings : 联盟起艺卢帅正锐黑体 (LMQYLuShuai, SIL OFL)        → public/fonts/lmqy-lushuai.woff2
  Chinese body     : 思源黑体 / Noto Sans SC 400 + 700 (SIL OFL)      → public/fonts/source-han-sans-{400,700}.woff2

Sources are npm packages (same as the Tech-Map project):
  mkdir -p ~/fonts && cd ~/fonts && npm i @fontpkg/lianmengqiyilushuaizhengruiheiti @fontsource/noto-sans-sc
  pip install --break-system-packages fonttools brotli
Run:
  WTT_FONTS=~/fonts/node_modules python3 scripts/build-fonts.py [--gb2312]

Re-run whenever data/ or the UI strings gain new Chinese characters (characters outside the subset
fall back to the system Chinese font). --gb2312 also embeds all 6,763 GB2312 hanzi (much larger files).
"""
import os, sys, glob
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FD = os.path.expanduser(os.environ.get('WTT_FONTS', '~/fonts/node_modules'))
OUT = os.path.join(ROOT, 'public', 'fonts')

SOURCES = {
    'lmqy-lushuai.woff2': '@fontpkg/lianmengqiyilushuaizhengruiheiti/联盟起艺卢帅正锐黑体.ttf',
    'source-han-sans-400.woff2': '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2',
    'source-han-sans-700.woff2': '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff2',
}

def site_chars():
    files = glob.glob(os.path.join(ROOT, 'data', '**', '*.json'), recursive=True)
    files += glob.glob(os.path.join(ROOT, 'public', 'js', '*.js')) + [os.path.join(ROOT, 'public', 'index.html')]
    cs = set()
    for f in files:
        with open(f, encoding='utf-8') as fh:
            cs |= {c for c in fh.read() if ord(c) >= 0x2000}
    cs |= set(chr(i) for i in range(0x20, 0x7f))
    cs |= set('，。、；：？！“”‘’（）【】《》…—·「」『』〈〉％￥～　0123456789')
    if '--gb2312' in sys.argv:
        for hi in range(0xB0, 0xF8):
            for lo in range(0xA1, 0xFF):
                try: cs.add(bytes([hi, lo]).decode('gb2312'))
                except UnicodeDecodeError: pass
    return cs

def build(src, dst, chars):
    f = TTFont(src)
    o = subset.Options(); o.flavor = 'woff2'; o.layout_features = ['*']; o.notdef_outline = True; o.hinting = False
    o.name_IDs = [0, 1, 2, 13, 14]   # keep copyright + licence records (OFL)
    s = subset.Subsetter(o); s.populate(unicodes=[ord(c) for c in chars]); s.subset(f)
    f.flavor = 'woff2'; f.save(dst)
    return os.path.getsize(dst)

if __name__ == '__main__':
    chars = site_chars()
    print(f'{len(chars)} characters')
    for name, rel in SOURCES.items():
        src = os.path.join(FD, rel)
        if not os.path.exists(src): sys.exit(f'missing {src} — see the header of this script')
        print(f'  {name:28s} {build(src, os.path.join(OUT, name), chars) // 1024} KB')
