import os,subprocess,sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.check_call([sys.executable,R+'/tools/mk_p10.py'])
s=open(R+'/preview10.html',encoding='utf8').read()
css=open(R+'/tools/theme-p11.css',encoding='utf8').read()
open(R+'/preview11.html','w',encoding='utf8').write(s.replace('</head>','<style id="bs-theme-p11">\n'+css+'</style>\n</head>',1))
