import os
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s=open(R+'/preview.html',encoding='utf8').read()
css=open(R+'/tools/theme-p4.css',encoding='utf8').read()
s=s.replace("</head>",'<style id="bs-theme-p4">\n'+css+'</style>\n</head>',1)
s=s.replace("document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light')","document.documentElement.setAttribute('data-theme','light')",1)
open(R+'/preview4.html','w',encoding='utf8').write(s)
