import {sha256,type CheckpointFile} from '../contracts/index.js';
import type {MaterialSnapshot,SnapshotBodyReference} from '../tools/evidence.js';
import {encodeSnapshotBody} from '../tools/bodies.js';
import type {HostProject} from './controller.js';
export type {SnapshotBodyReference} from '../tools/evidence.js';
type StoredSnapshot=MaterialSnapshot&{body_reference?:SnapshotBodyReference;body_metadata?:{line_count:number;page_count:number|null}};
/** Evidence bodies have independent immutable file identities; control checkpoints only carry metadata. */
export function storeProjectBodies(project:HostProject,knownFiles:ReadonlyMap<string,{sha256:string;size:number}>):{project:HostProject;files:CheckpointFile[]}{
 const stored=structuredClone(project);const files:CheckpointFile[]=[];
 stored.snapshots=project.snapshots.map(snapshot=>{
  const existing=(snapshot as StoredSnapshot).body_reference;
  if(existing&&snapshot.text===''){const known=knownFiles.get(existing.path);if(existing.schema_version!==1||!existing.path.startsWith(`projects/${project.project_id}/snapshots/`)||existing.path.includes('..')||!known||known.sha256!==existing.sha256||known.size!==existing.bytes)throw new Error('snapshot_body_reference_invalid');return structuredClone(snapshot);}
  const encoded=encodeSnapshotBody(snapshot,project.project_id),{bytes}=encoded,{path,sha256:hash}=encoded.reference;
  const known=knownFiles.get(path);if(known&&(known.sha256!==hash||known.size!==bytes.length))throw new Error('snapshot_body_file_conflict');
  if(!known)files.push({path,bytes,role:'evidence',project_id:project.project_id});
  return encoded.snapshot;
 });
 return {project:stored,files};
}
export async function hydrateProjectBodies(project:HostProject,read:(path:string)=>Promise<Uint8Array>):Promise<HostProject>{
 const result=structuredClone(project);result.snapshots=[];
 for(const snapshot of project.snapshots){const ref=(snapshot as StoredSnapshot).body_reference;
  if(!ref){if(sha256(snapshot.text)!==snapshot.hash)throw new Error('snapshot_body_hash_mismatch');result.snapshots.push(snapshot);continue;}
  if(ref.schema_version!==1||!ref.path.startsWith(`projects/${project.project_id}/snapshots/`)||ref.path.includes('..'))throw new Error('snapshot_body_reference_invalid');
  const bytes=await read(ref.path);if(bytes.length!==ref.bytes||sha256(bytes)!==ref.sha256)throw new Error('snapshot_body_file_corrupt');
  const body=JSON.parse(Buffer.from(bytes).toString('utf8')) as {schema_version?:number;text?:unknown;pages?:unknown};
  if(body.schema_version!==1||typeof body.text!=='string'||sha256(body.text)!==snapshot.hash||body.pages!==undefined&&(!Array.isArray(body.pages)||body.pages.some(page=>typeof page!=='string')))throw new Error('snapshot_body_payload_corrupt');
  result.snapshots.push({...snapshot,text:body.text,...(body.pages?{pages:body.pages as string[]}:{})});
 }
 return result;
}
