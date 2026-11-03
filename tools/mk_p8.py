import os,subprocess,sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.check_call([sys.executable,R+'/tools/mk_p7.py'])
s=open(R+'/preview7.html',encoding='utf8').read()
css=open(R+'/tools/theme-p8.css',encoding='utf8').read()
s=s.replace('</head>','<style id="bs-theme-p8">\n'+css+'</style>\n</head>',1)
open(R+'/preview8.html','w',encoding='utf8').write(s)
