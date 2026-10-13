import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {digest} from '../stages/contracts.js';
import {runFireworks,type SkillBundle} from './skills.js';
import {safeRelative} from './files.js';
export type RenderedImage={source:string;png:string;source_hash:string;png_hash:string;width:number;height:number;structural_check:string;visual_check:'pending'};
export function imageMime(bytes:Uint8Array):'image/png'|'image/jpeg'|'image/webp'{const buffer=Buffer.from(bytes);if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'image/webp';throw new Error('image_format_denied');}
export function pngDimensions(bytes:Uint8Array):{width:number;height:number}{const buffer=Buffer.from(bytes);if(buffer.length<24||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||buffer.toString('ascii',12,16)!=='IHDR')throw new Error('invalid_png');return {width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};}
export async function renderDiagram(bundle:SkillBundle,input:{project_id:string;mode:string;name:string;diagram:unknown},deadline:number):Promise<RenderedImage>{
  if(!/^[a-zA-Z0-9_-]+$/.test(input.project_id)||!/^[a-zA-Z0-9_-]+$/.test(input.name)||!/^[a-zA-Z0-9_-]+$/.test(input.mode))throw new Error('render_identity_invalid');
  const prefix=safeRelative(`projects/${input.project_id}/draft/图文件/${input.name}`);const json=`${prefix}.json`,svg=`${prefix}.svg`,png=`${prefix}.png`;await mkdir(path.dirname(path.join(bundle.root,json)),{recursive:true});await writeFile(path.join(bundle.root,json),JSON.stringify(input.diagram));
  await runFireworks(bundle,['validate',input.mode,json],deadline);await runFireworks(bundle,['render',input.mode,json,svg],deadline);const check=await runFireworks(bundle,['check',svg],deadline);await runFireworks(bundle,['export-png',svg,png,'--width','1920'],deadline);
  const image=await readFile(path.join(bundle.root,png));const dimensions=pngDimensions(image);return {source:svg,png,source_hash:digest(await readFile(path.join(bundle.root,svg))),png_hash:digest(image),...dimensions,structural_check:check,visual_check:'pending'};
}
