import os,subprocess,sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.check_call([sys.executable,R+'/tools/mk_p5.py'])
s=open(R+'/preview5.html',encoding='utf8').read()
css=open(R+'/tools/theme-p6.css',encoding='utf8').read();js=open(R+'/tools/theme-p6.js',encoding='utf8').read()
s=s.replace('</head>','<style id="bs-theme-p6">\n'+css+'</style>\n</head>',1).replace('</body>','<script>'+js+'</script>\n</body>',1)
open(R+'/preview6.html','w',encoding='utf8').write(s)
