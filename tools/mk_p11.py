import os,subprocess,sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.check_call([sys.executable,R+'/tools/mk_p10.py'])
s=open(R+'/preview10.html',encoding='utf8').read()
css=open(R+'/tools/theme-p11.css',encoding='utf8').read()+'\n'+(open(R+'/tools/theme-p12-unslop.css',encoding='utf8').read() if os.path.exists(R+'/tools/theme-p12-unslop.css') and not os.environ.get('BS_LIVE') else '')+'\n'+(open(R+'/tools/theme-p13-app.css',encoding='utf8').read() if os.path.exists(R+'/tools/theme-p13-app.css') and not os.environ.get('BS_LIVE') else '');js=open(R+'/tools/theme-p11.js',encoding='utf8').read()+('' if os.environ.get('BS_LIVE') else open(R+'/tools/theme-p13-app.js',encoding='utf8').read())
open(R+'/preview11.html','w',encoding='utf8').write(s.replace('</head>','<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700;800&display=swap">\n<style id="bs-theme-p11">\n'+css+'</style>\n</head>',1).replace('</body>','<script>'+js+'</script>\n</body>',1).replace('js/p-app.js?v=','js/p-app.js?r=2&v='))
