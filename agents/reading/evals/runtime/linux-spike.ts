import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {materializeSkills,readSkill,runFireworks} from '../../src/tools/skills.js';
import {renderDiagram} from '../../src/tools/render.js';
import {readBrowser} from '../../src/tools/browser.js';
import {UrlGateway} from '../../src/tools/fetch.js';
import {SandboxRunner} from '../../src/tools/sandbox.js';
const exec=promisify(execFile);
const repository=process.env.READING_TEST_NOTES_REPOSITORY;
const commit=process.env.READING_TEST_SKILL_COMMIT;
const output=resolve(process.env.READING_TEST_LINUX_OUTPUT??'.reading-local/linux-spike');
if(!repository||!commit||!process.env.READING_TOOLS_IMAGE)throw new Error('explicit_linux_test_repository_commit_image_required');
await mkdir(output,{recursive:true});const bundle=await materializeSkills(repository,commit,join(output,'view'));const deadline=Date.now()+120_000;
const skill=await readSkill(bundle,'obsidian-note');const playbook=await readSkill(bundle,'obsidian-note','references/diagram-playbook.md');const doctor=JSON.parse(await runFireworks(bundle,['doctor'],deadline));
const fixture=JSON.parse(await readSkill(bundle,'fireworks-tech-graph','fixtures/tool-call-style2.json'));
fixture.title='阅读 Agent 工具循环';fixture.subtitle='证据采集、受限执行与笔记生成';fixture.meta_center='可信工具与持久化证据';fixture.footer='阅读 Agent · 结构检查与视觉校验';const labels:Record<string,string>={query:'阅读问题',retrieve:'证据检索',generate:'生成笔记',grounded:'可核查输出',agent:'阅读 Agent',terminal:'受限工具',knowledge:'证据账本',documents:'原始材料'};for(const node of fixture.nodes){node.label=labels[node.id]??node.label;delete node.sublabel;delete node.glow;if(['knowledge','documents'].includes(node.id))node.kind='rect';}
const rendered=await renderDiagram(bundle,{project_id:'linux_spike',mode:String(fixture.mode),name:'tool-call',diagram:fixture},deadline);
const gateway=new UrlGateway(async url=>{if(!url.startsWith('https://fixture.example/'))throw new Error('outside_fixture');},async()=>[{address:'8.8.8.8',family:4}],async()=>({status:200,headers:{'content-type':'text/html; charset=utf-8'},body:Buffer.from('<html><body><main><h1>中文工程流程</h1><p>可信网关提供正文，浏览器没有网络和凭据。</p></main></body></html>')}));
const browser=await readBrowser(gateway,'https://fixture.example/article',deadline);
const isolation=JSON.parse(await new SandboxRunner().run('python3',['-c',`import json, os, socket\nsecrets = [k for k in os.environ if k.startswith(('OSS_', 'GITHUB_', 'ANTHROPIC_', 'DEEPSEEK_'))]\nreadonly=False\ntry:\n open('/etc/reading-test-write', 'w').write('blocked')\nexcept OSError:\n readonly=True\nnetwork=False\ntry:\n s=socket.create_connection(('8.8.8.8', 443), timeout=2);s.close();network=True\nexcept OSError:\n pass\nprint(json.dumps({'controller_secrets_absent':not secrets,'readonly_root_enforced':readonly,'outbound_network_denied':not network,'host_filesystem_absent':not os.path.exists('/Users/lim/workspace')}))`],[],deadline));
const image=(await exec('docker',['image','inspect','--format','{{.Id}}',process.env.READING_TOOLS_IMAGE])).stdout.trim();
const report={status:'linux_tool_verified',environment:'Linux Docker with network none, read-only root, no controller secrets',image_id:image,skill_commit:commit,skill_bundle_hash:bundle.hash,
  skill_read:skill.length>0,playbook_read:playbook.length>0,cloud_skill_adapted:bundle.adapted,doctor,rendered,browser_snapshot_hash:browser.hash,browser_text:browser.text,isolation,
  sdk_skill_activation:'not_exercised',model_review:'not_exercised',human_visual_review:'pending',g2:'not_passed'};
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:join(output,'report.json'),png:join(bundle.root,rendered.png),image_id:image,g2:'not_passed'}));
