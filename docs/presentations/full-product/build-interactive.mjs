import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory=path.dirname(fileURLToPath(import.meta.url));
const names=['HERO','LOGO','SCAN','HISTORY','SHOP','RECOVERY'];
const assets=Object.fromEntries(await Promise.all(names.map(async name=>[
  name,'data:image/webp;base64,'+(await fs.readFile(path.join(directory,'assets',name.toLowerCase()+'.webp'))).toString('base64'),
])));
let html=await fs.readFile(path.join(directory,'interactive.template.html'),'utf8');
html=html.replaceAll('const assets=__ASSETS__;', 'const assets='+JSON.stringify(assets)+';')
  .replaceAll(/src="__(\w+)__"/g,'data-asset="$1"')
  .replaceAll(/'__(\w+)__'/g,"'$1'");
if(/__[A-Z]+__/.test(html))throw new Error('Unresolved asset placeholder');
await fs.writeFile(path.join(directory,'../DeepSpec-Full-Interactive.html'),html);
