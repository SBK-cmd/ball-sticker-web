import os,subprocess,sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.check_call([sys.executable,R+'/tools/mk_p4.py'])
s=open(R+'/preview4.html',encoding='utf8').read()
css=open(R+'/tools/theme-p5.css',encoding='utf8').read()
font='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap">\n'
js='''<script>(function(){function ic(){document.querySelectorAll('.tax-sheet-item[data-tab]').forEach(function(b){if(b.querySelector('.tsi'))return;var s=document.querySelector('header.top .tabs button[data-tab="'+b.dataset.tab+'"] svg');if(!s)return;var w=document.createElement('span');w.className='tsi';w.setAttribute('aria-hidden','true');w.appendChild(s.cloneNode(true));b.insertBefore(w,b.firstChild)})}
document.addEventListener('DOMContentLoaded',function(){ic();setTimeout(ic,800)})})();</script>
'''
s=s.replace('</head>',font+'<style id="bs-theme-p5">\n'+css+'</style>\n</head>',1).replace('</body>',js+'</body>',1)
open(R+'/preview5.html','w',encoding='utf8').write(s)
