import { describe,it,expect } from 'vitest';
import { parseTrustedPolicy,type PolicySnapshot } from '../../src/config/trusted-policy.js';

const snapshot=(runtime=''):PolicySnapshot=>({commit:'a'.repeat(40),files:{
  'preferences.yaml':'schema_version: 1\nexcluded_topics: []\nexcluded_content_types: [marketing]\n',
  'sources.yaml':'schema_version: 1\nmanual_url: { enabled: true }\nsources: { official: { enabled: true, domains: [example.org] } }\n',
  'runtime.yaml':'schema_version: 1\ncost_policy: observe_only\nstorage_limit_bytes: 50000000000\npaused: false\npaused_projects: []\nallowed_domains: [example.org]\ndenied_domains: []\n'+runtime,
}});
describe('trusted current policy',()=>{
  it('binds real commit and hashes semantic rules independently of pause changes',()=>{
    const a=parseTrustedPolicy(snapshot());
    const b=snapshot();b.commit='b'.repeat(40);b.files['runtime.yaml']=b.files['runtime.yaml'].replace('paused: false','paused: true');
    const changed=parseTrustedPolicy(b);
    expect(changed.hash).not.toBe(a.hash);expect(changed.semantic_policy_hash).toBe(a.semantic_policy_hash);expect(changed.paused).toBe(true);
  });
  it('fails rather than accepting stale/default malformed configuration',()=>{
    const b=snapshot();b.files['runtime.yaml']=b.files['runtime.yaml'].replace('50000000000','100000000000');
    expect(()=>parseTrustedPolicy(b)).toThrow('intent_resource');
    const c=snapshot();c.files['sources.yaml']='schema_version: 2';expect(()=>parseTrustedPolicy(c)).toThrow('unknown_policy_schema');
  });
});
