from pathlib import Path
import hashlib,re,json
root=Path('dist');html=(root/'index.html').read_text()
versions={}
for stem,ext in [('styles','css'),('intro','js'),('signin','css'),('signin','js'),('micro','css'),('micro','js')]:
 data=(root/f'{stem}.{ext}').read_bytes();digest=hashlib.sha256(data).hexdigest()[:12]
 name=f'{stem}.{digest}.{ext}'
 for old in root.glob(f'{stem}.*.{ext}'):old.unlink()
 (root/name).write_bytes(data)
 html=re.sub(r'/'+stem+r'(?:\.[a-f0-9]{12})?\.'+ext,'/'+name,html)
 versions[stem+'.'+ext]=digest
logo_digest=hashlib.sha256((root/'assets/white-logo-horizontal.svg').read_bytes()).hexdigest()[:12]
html=re.sub(r'(/assets/white-logo-horizontal\.svg)(?:\?v=[a-f0-9]{12})?',lambda match:match[1]+'?v='+logo_digest,html)
html=html.replace('content="#00152a"','content="#0b1520"')
(root/'index.html').write_text(html)
m=json.loads((root/'site.webmanifest').read_text());m['background_color']=m['theme_color']='#0b1520';(root/'site.webmanifest').write_text(json.dumps(m,indent=2)+'\n')
print(json.dumps(versions))
