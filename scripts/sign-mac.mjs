import {sign} from '@electron/osx-sign';
import {openSync,readSync,closeSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
const identity=process.env.QINCHE_SIGN_IDENTITY;
if(!identity)throw Error('Set QINCHE_SIGN_IDENTITY to your Developer ID Application identity');
const app=resolve('release/秦彻陪伴-darwin-arm64/秦彻陪伴.app');
const magic=new Set(['feedface','feedfacf','cefaedfe','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca']);
function ignore(file){
 if(statSync(file).isDirectory())return false;
 const fd=openSync(file,'r');const b=Buffer.alloc(4);try{readSync(fd,b,0,4,0);}finally{closeSync(fd);}
 return !magic.has(b.toString('hex'));
}
// Sign executable code and enclosing bundles, not GIFs, archives, or Chromium locale packs.
await sign({app,identity,type:'distribution',platform:'darwin',hardenedRuntime:true,
 gatekeeperAssess:false,preAutoEntitlements:false,ignore,
 optionsForFile:()=>({entitlements:resolve('scripts/entitlements.mac.plist')})});
console.log('Developer ID signing complete');
