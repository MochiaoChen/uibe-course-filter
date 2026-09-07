"""Build a file:// preview of the extension UI; no local server required."""
from pathlib import Path
import json,re,zipfile
root=Path(__file__).resolve().parent.parent
ext=root/'extension-unified'
html=(ext/'index.html').read_text()
css=(ext/'style.css').read_text()
core=(ext/'core.js').read_text().replace('export ','')
app=(ext/'app.js').read_text()
app=re.sub(r"^import .*?;\n",'',app,count=1)
snapshot=json.loads((ext/'snapshot.json').read_text())
encoded=json.dumps(snapshot,ensure_ascii=False).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
app=app.replace("const response=await fetch('snapshot.json');if(!response.ok)throw new Error('本地课程文件加载失败。');useData(await response.json());",'useData('+encoded+');')
html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>')
html=html.replace('<script type="module" src="app.js"></script>','<script type="module">'+core+'\n'+app+'</script>')
(root/'课程筛选合一版.html').write_text(html)
with zipfile.ZipFile(root/'贸大课程库合一版.zip','w',zipfile.ZIP_DEFLATED) as z:
 for p in ext.rglob('*'):
  if p.is_file():z.write(p,p.relative_to(root))
print('Built offline preview and extension ZIP.')
