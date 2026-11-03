import os,subprocess,sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.check_call([sys.executable,R+'/tools/mk_p8.py'])
s=open(R+'/preview8.html',encoding='utf8').read()
for k in 'ab':
    css=open(R+'/tools/theme-p9%s.css'%k,encoding='utf8').read()
    open(R+'/preview9%s.html'%k,'w',encoding='utf8').write(s.replace('</head>','<style id="bs-theme-p9%s">\n'%k+css+'</style>\n</head>',1))
