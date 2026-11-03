#!/usr/bin/env python3
# ก๊อป js/fitcurve.js (ระหว่าง FIT-BEGIN..FIT-END) เข้า SignTools/jsx/host.jsx ให้เหมือนกันเป๊ะ
import re,sys,os
d=os.path.dirname(os.path.abspath(__file__))+'/SignTools/'
src=open(d+'js/fitcurve.js',encoding='utf-8').read()
blk=src[src.index('// ===FIT-BEGIN==='):src.index('// ===FIT-END===')+len('// ===FIT-END===')]
h=open(d+'jsx/host.jsx',encoding='utf-8').read()
if '// ===FIT-BEGIN===' in h:
    h=h[:h.index('// ===FIT-BEGIN===')]+blk+h[h.index('// ===FIT-END===')+len('// ===FIT-END==='):]
else:
    m='function st_smoothPath('
    h=h.replace(m,blk+'\n'+m,1)
open(d+'jsx/host.jsx','w',encoding='utf-8').write(h); print('synced')
