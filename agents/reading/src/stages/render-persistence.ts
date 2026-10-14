import type {RenderPersistence} from '../tools/render.js';
import type {RuntimeProject,RuntimeFile,RuntimeEnvironment} from './driver.js';
/** Reads only manifest-restored files and commits all source facts in one host checkpoint. */
export function createRenderPersistence(project:RuntimeProject,rendered:Record<string,Uint8Array>,files:RuntimeFile[],commit:RuntimeEnvironment['commit']):RenderPersistence{
 return {
  load:async identity=>{const base=`图文件/${identity.project_id}/${identity.name}`;const receipt_bytes=rendered[base+'.render-check.json'],input_bytes=rendered[base+'.json'],source_bytes=rendered[base+'.svg'];if(!receipt_bytes&&!input_bytes&&!source_bytes)return null;if(!receipt_bytes||!input_bytes||!source_bytes)throw new Error('render_checkpoint_incomplete');return {receipt_bytes,input_bytes,source_bytes};},
  save:async checkpoint=>{const artifacts:RuntimeFile[]=checkpoint.files.map(item=>({path:`projects/${project.project_id}/draft/${item.path}`,bytes:item.bytes,role:'artifact',project_id:project.project_id}));await commit(project,artifacts,'render_source_checked');for(const item of checkpoint.files)rendered[item.path]=item.bytes;for(const artifact of artifacts){const index=files.findIndex(item=>item.path===artifact.path);if(index>=0)files[index]=artifact;else files.push(artifact);}},
 };
}
