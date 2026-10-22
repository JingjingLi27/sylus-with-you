import {execFileSync} from 'node:child_process';
import {mkdir,readFile,rm,symlink,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='darwin')throw Error('DMG must be built on macOS');
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const app=join(root,'release/秦彻陪伴-darwin-arm64/秦彻陪伴.app');
const stage=join(root,'release/dmg-stage');
await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
execFileSync('ditto',[app,join(stage,'秦彻陪伴.app')],{stdio:'inherit'});
// Local ad-hoc signature maintains bundle integrity; this is NOT Developer ID or notarization.
execFileSync('codesign',['--force','--deep','--sign','-',join(stage,'秦彻陪伴.app')],{stdio:'inherit'});
execFileSync('codesign',['--verify','--deep','--strict',join(stage,'秦彻陪伴.app')],{stdio:'inherit'});
await symlink('/Applications',join(stage,'Applications'));
await copyFile(join(root,'INSTALL.md'),join(stage,'安装说明.md'));
const dmg=join(root,`release/Sylus-with-You-${version}-macOS-Apple-Silicon.dmg`);
execFileSync('hdiutil',['create','-volname','Sylus with You','-srcfolder',stage,'-ov','-format','UDZO',dmg],{stdio:'inherit'});
console.log(dmg);
