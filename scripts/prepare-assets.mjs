// Copy approved assets without changing originals; missing files fail the build.
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const defaultAppRoot=join(dirname(fileURLToPath(import.meta.url)),'..');
export async function prepareAssets({appRoot=defaultAppRoot}={}) {
 const catalog=JSON.parse(await readFile(join(appRoot,'src/config/animation-catalog.json'),'utf8'));
 const runtime=join(appRoot,'assets/runtime');await mkdir(join(runtime,'gifs'),{recursive:true});
 const gifs=[];
 for(const a of catalog) {
  const source=join(appRoot,a.source);const bytes=await readFile(source);
  await cp(source,join(runtime,a.file));
  gifs.push({visualId:'a'+a.id,file:a.file,width:a.width,height:a.height,frames:a.frames,durationMs:a.durationMs,sha256:createHash('sha256').update(bytes).digest('hex'),sourceId:a.origin+':'+a.id});
 }
 const manifest={schemaVersion:2,generatedAt:new Date().toISOString(),note:'原始01–20与用户确认的21–25，洗头采用v3。25-touch为点击反应片段。',gifs,missing:[]};
 await writeFile(join(runtime,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log(`[prepare-assets] copied ${gifs.length} approved animations`);return manifest;
}
if(import.meta.url===`file://${process.argv[1]}`)prepareAssets().catch(e=>{console.error(e);process.exit(1);});
