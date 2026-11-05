import os,subprocess,sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.check_call([sys.executable,R+'/tools/mk_p9.py'])
s=open(R+'/preview9a.html',encoding='utf8').read()
css=open(R+'/tools/theme-p10.css',encoding='utf8').read()
open(R+'/preview10.html','w',encoding='utf8').write(s.replace('</head>','<style id="bs-theme-p10">\n'+css+'</style>\n</head>',1))
