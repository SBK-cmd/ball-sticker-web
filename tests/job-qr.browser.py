"""Offline CEP integration: no Firebase, license calls, Illustrator or cutter commands."""
from pathlib import Path
import re,json
from playwright.sync_api import sync_playwright,expect
R=Path(__file__).resolve().parents[1]; P=R/'signtools-panel/SignTools'
h=re.sub(r'<script\b[^>]*>.*?</script>','',(P/'index.html').read_text(),flags=re.S)
h=h.replace('<link rel="stylesheet" href="css/style.css">','<style>'+(P/'css/style.css').read_text()+'</style>')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':520,'height':1100});errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
 page.route('https://**/*',lambda r:r.abort())
 page.set_content(h)
 page.evaluate('''() => { window.STPromptPay={};window.sent=[]; window.__adobe_cep__={evalScript(s,cb){
  const fn=s.slice(0,s.indexOf('(')), a=s.slice(s.indexOf('(')+1,-1);let r={ok:true,msg:'mock host'};
  if(fn==='st_lastCrash')r={none:true};
  if(fn==='st_stkRead'){const mm=72/25.4;r={sf:window.testSF||1,items:[{name:'ลายเล็ก 30 × 20 มม.',vb:[0,20*mm,30*mm,0]},{name:'ลายใหญ่ 60 × 40 มม.',vb:[0,40*mm,60*mm,0]}]};if(window.testSF)r.items.forEach(i=>i.vb=i.vb.map(v=>v/window.testSF));}
  if(fn==='st_stkPlace')window.sent.push(JSON.parse(a));cb(JSON.stringify(r));
 }}; }''')
 for name in ['lib/qrcode.js','tools.js','pack.js','job-qr.js','sticker.js']:
  page.add_script_tag(content=(P/'js'/name).read_text())
 # Exercise the queue -> layout shortcut using an entirely local fake Firestore transport.
 page.evaluate('''() => {
  window.ST_core={features:()=>Promise.resolve({queue:{projectId:'test-project',apiKey:'invalid-test-placeholder'}})};
  window.mockWrites=[];
  window.XMLHttpRequest=class {
   open(method,url){this.method=method;this.url=url} setRequestHeader(){}
   send(){let r={};if(this.method==='PATCH')mockWrites.push(this.url);
    if(this.url.includes('accounts:signUp'))r={idToken:'not-a-real-token',refreshToken:'not-a-real-token',expiresIn:3600};
    else if(this.url.includes('/documents/jobs?'))r={documents:[{name:'projects/test-project/databases/(default)/documents/jobs/test-qr-job',fields:{no:{stringValue:'JB-QR-TEST'},jName:{stringValue:'ตัวอย่างทดสอบ'},status:{stringValue:'pending'},date:{stringValue:'2026-11-07'}}}]};
    else if(this.url.includes('/documents/wholesale?'))r={documents:[]};
    this.status=200;this.responseText=JSON.stringify(r);setTimeout(()=>this.onload(),0);
   }
  };
 }''')
 page.add_script_tag(content=(P/'js/queue.js').read_text())
 expect(page.locator('#stkJobQRJob option[value=test-qr-job]')).to_have_count(1)
 page.locator('.tab[data-tab=queue]').click();page.locator('#cqList .qjob').first.click()
 page.locator('#cqModal [data-act=jobqr]').click()
 expect(page.locator('#tab-stk')).to_have_class(re.compile('active'))
 expect(page.locator('#stkJobQROn')).to_be_checked()
 assert page.evaluate('mockWrites.length')==0
 page.locator('#stkJobQROn').uncheck()
 page.evaluate("document.dispatchEvent(new CustomEvent('st:qrjobs',{detail:[{id:'test-qr-job',no:'JB-QR-TEST',jName:'ตัวอย่างทดสอบ'}]}))")
 page.locator('#stkRead').click()
 expect(page.locator('#stkHint')).to_contain_text('อ่านได้ 2 ลาย')
 page.locator('.seg[data-name=stkMode] [data-v=multi]').click()
 page.locator('#stkSheet').select_option('custom')
 page.locator('#stkW').fill('210');page.locator('#stkW').dispatch_event('change')
 page.locator('#stkH').fill('297');page.locator('#stkH').dispatch_event('change')
 page.wait_for_timeout(400)
 # Baseline QR off remains ordinary packing.
 page.locator('#stkGo').click();assert page.evaluate('sent.at(-1).jobQR') is None
 baseline=page.evaluate('__stk.result().placed');assert baseline==20
 assert page.evaluate("__stk.selectJob('test-qr-job')")
 expect(page.locator('#stkJobQRHint')).to_contain_text('JB-QR-TEST')
 page.locator('#stkGo').click()
 sent=page.evaluate('sent.at(-1)');assert len(sent['jobQR'])==len(sent['sheets'])
 assert sum(len(s) for s in sent['sheets'])==20
 for i,q in enumerate(sent['jobQR']):
  assert q['sheet']==i+1 and q['total']==len(sent['sheets'])
  assert q['jobId']=='test-qr-job' and 'job=test-qr-job' in q['url']
  bottom=q['y']+q['size']+9*72/25.4;assert bottom<=sent['sheetHs'][i]+.001
  for piece in sent['sheets'][i]:assert piece['y']<q['y']
 (R/'tests/qr-host-payload.json').write_text(json.dumps(sent,ensure_ascii=False))
 # Show selected job and layout in one image, generated from actual panel geometry.
 page.locator('#stkJobQRCard').scroll_into_view_if_needed();page.screenshot(path=str(R/'job-qr-panel.png'))
 # Produce a high-resolution QR test card from the exact matrix sent to the host.
 data=page.evaluate('''q=>{let c=document.createElement('canvas'),n=q.rows.length+8;c.width=c.height=n*12;let g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,c.width,c.height);g.fillStyle='black';q.rows.forEach((r,y)=>[...r].forEach((v,x)=>{if(v==='1')g.fillRect((x+4)*12,(y+4)*12,12,12)}));return c.toDataURL('image/png').split(',')[1]}''',sent['jobQR'][0])
 import base64
 (R/'job-qr-scan-test.png').write_bytes(base64.b64decode(data))
 # Missing job in refreshed queue invalidates stale selection.
 before=page.evaluate('sent.length');page.evaluate("document.dispatchEvent(new CustomEvent('st:qrjobs',{detail:[]}))")
 expect(page.locator('#stkGo')).to_be_disabled();assert page.evaluate('sent.length')==before
 # Reading another artwork selection clears the old QR association.
 page.evaluate("document.dispatchEvent(new CustomEvent('st:qrjobs',{detail:[{id:'test-qr-job',no:'JB-QR-TEST'}]}));__stk.selectJob('test-qr-job')")
 page.locator('#stkRead').click();expect(page.locator('#stkJobQROn')).not_to_be_checked()
 # Large Canvas scale and normal print marks.
 page.evaluate('window.testSF=10');page.locator('#stkRead').click();page.locator('#stkCm5').uncheck();page.locator('#stkMarks').check()
 page.evaluate("__stk.selectJob('test-qr-job')")
 page.wait_for_timeout(400);page.locator('#stkGo').click()
 small=page.evaluate('sent.at(-1)');assert abs(small['jobQR'][0]['size']-28*72/25.4/10)<.001
 assert small['marks'] and small['cm5'] is None
 # Corel never receives unsupported job QR output.
 page.evaluate('window.ST_COREL={};document.dispatchEvent(new CustomEvent("st:qrjobs",{detail:[]}))')
 page.locator('#stkGo').evaluate('(b)=>b.click()');assert page.evaluate('sent.length')==before+1
 assert not errs,errs
 b.close();print('PASS: CEP payload, mixed sizes/counts, reserved footer, labels, stale job, new artwork, Large Canvas, standard/CM5 settings, Corel guard; no browser errors')
