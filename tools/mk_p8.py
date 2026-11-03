import os,subprocess,sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.check_call([sys.executable,R+'/tools/mk_p7.py'])
s=open(R+'/preview7.html',encoding='utf8').read()
css=open(R+'/tools/theme-p8.css',encoding='utf8').read()
js=open(R+'/tools/theme-p8.js',encoding='utf8').read()
s=s.replace('</head>','<style id="bs-theme-p8">\n'+css+'</style>\n</head>',1)
s=s.replace('</body>','<script id="bs-theme-p8-js">\n'+js.replace('</script','<\\/script')+'</script>\n</body>',1)
open(R+'/preview8.html','w',encoding='utf8').write(s)
