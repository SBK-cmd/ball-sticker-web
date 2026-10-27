import os
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s=open(R+'/preview.html',encoding='utf8').read()
css=open(R+'/tools/theme-p4.css',encoding='utf8').read()
font='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600&display=swap">\n'
s=s.replace("</head>",font+'<style id="bs-theme-p4">\n'+css+'</style>\n</head>',1)
s=s.replace("document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light')","document.documentElement.setAttribute('data-theme','light')",1)
open(R+'/preview4.html','w',encoding='utf8').write(s)
