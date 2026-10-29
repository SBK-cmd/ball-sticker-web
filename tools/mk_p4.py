import os
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s=open(R+'/preview.html',encoding='utf8').read()
css=open(R+'/tools/theme-p4.css',encoding='utf8').read()
JS="<script>(function(){var RE=/[\\u{1F300}-\\u{1FAFF}\\u{2728}\\u{2600}-\\u{2603}\\u{260E}\\u{2B50}]\\uFE0F?\\s*/gu;function clean(n){var w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT),t,a=[];while(t=w.nextNode()){if(RE.test(t.nodeValue)){RE.lastIndex=0;var p=t.parentNode;if(p&&!/^(SCRIPT|STYLE|TEXTAREA|INPUT)$/.test(p.nodeName))a.push(t)}RE.lastIndex=0}a.forEach(function(t){t.nodeValue=t.nodeValue.replace(RE,'')})}\nfunction go(){clean(document.body)}document.addEventListener('DOMContentLoaded',function(){go();var q;new MutationObserver(function(){clearTimeout(q);q=setTimeout(go,60)}).observe(document.body,{childList:true,subtree:true,characterData:true})})})();</script>\n"
font='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600&display=swap">\n'
s=s.replace("</head>",font+'<style id="bs-theme-p4">\n'+css+'</style>\n</head>',1)
for old in ("document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light')","document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark')"):
    s=s.replace(old,"document.documentElement.setAttribute('data-theme','light')",1)
s=s.replace('</body>',JS+'</body>',1)
open(R+'/preview4.html','w',encoding='utf8').write(s)
