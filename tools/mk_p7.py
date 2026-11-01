import os,subprocess,sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.check_call([sys.executable,R+'/tools/mk_p6.py'])
s=open(R+'/preview6.html',encoding='utf8').read()
css=open(R+'/tools/theme-p7.css',encoding='utf8').read()
s=s.replace('</head>','<style id="bs-theme-p7">\n'+css+'</style>\n</head>',1)
open(R+'/preview7.html','w',encoding='utf8').write(s)
