import {EventBindings} from '../src/renderer/view/event-bindings.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {ToolRegistry} from '../src/renderer/tools/tool-registry.mjs';
import {ImageProcessorTool, PointerTool} from '../src/renderer/tools/sdk/index.mjs';
import {builtinToolClasses} from '../src/renderer/tools/builtin/index.mjs';
import {ToolOptionsViewModel} from '../src/renderer/viewmodel/tool-options-view-model.mjs';
import {EditorSessionViewModel} from '../src/renderer/viewmodel/editor-session-view-model.mjs';
import {TimelineViewModel} from '../src/renderer/viewmodel/timeline-view-model.mjs';
const {ToolPluginService} = createRequire(import.meta.url)('../src/main/tool-plugin-service.cjs');
const definition = {id:'sample-tool', name:'Sample Tool', icon:'build', group:'features', mode:'adjustment',
  fields:[{key:'amount',label:'Amount',type:'range',min:0,max:100,defaultValue:20}]};
class SampleTool extends ImageProcessorTool { static definition = definition; }

test('built-ins and extensions share validation, inheritance, and processor services', async () => {
  const calls=[];
  const context={select:id=>calls.push(id),process:(...args)=>{calls.push(args);return {path:'owned.png'};},applyProcessor:()=>true};
  const registry=new ToolRegistry();
  for(const Tool of builtinToolClasses) registry.register(new Tool(context));
  const tool=registry.register(new SampleTool(context));
  assert.equal(registry.processors().length,3);assert.equal(tool.requiresEnable,true);
  tool.activate();assert.equal(calls.at(-1),'sample-tool');
  assert.deepEqual(await tool.process({path:'input.png'},{amount:50},{preview:true}),{path:'owned.png'});
  assert.equal(calls.at(-1)[3].preview,true);assert.equal(tool.apply(),true);
  assert.throws(()=>registry.register(new SampleTool(context)),/already registered/);
  assert.throws(()=>{tool.definition.fields[0].min=-1;},TypeError);
  assert.equal(definition.fields[0].min,0,'registry freezes its copy without freezing developer metadata');
});

test('invalid schemas and unsupported API versions cannot enter the registry',()=>{
  const registry=new ToolRegistry();
  for(const fields of [[{key:'invalid key',label:'X',type:'number'}],[{key:'x',label:'X',type:'number',min:0,max:10,defaultValue:20}],[{key:'x',label:'X',type:'select',options:[],defaultValue:'x'}]]) {
    class Bad extends ImageProcessorTool {static definition={...definition,fields};}
    assert.throws(()=>registry.register(new Bad({})));
  }
  class Old extends SampleTool {static apiVersion=2;}
  assert.throws(()=>registry.register(new Old({})),/version/);assert.equal(registry.values().length,0);
  class Pointer extends PointerTool {static definition={...definition,id:'pointer-tool',mode:'pointer',group:'basic',fields:[]};}
  assert.equal(registry.register(new Pointer({})).requiresEnable,false);
});

test('options clamp numeric values, restore all control types, and return independent snapshots',()=>{
  const model=new ToolOptionsViewModel([
    {key:'size',type:'number',min:1,max:100,step:1,defaultValue:4},
    {key:'enabled',type:'checkbox',defaultValue:false},
    {key:'color',type:'color',defaultValue:'#000000'},
    {key:'mode',type:'select',defaultValue:'a',options:[{value:'a',label:'A'},{value:'b',label:'B'}]}
  ]);
  const changes=[];const unsubscribe=model.subscribe(value=>changes.push(value));
  assert.equal(model.set('size',Infinity),4);assert.equal(model.set('size',1000),100);
  model.restore({size:2.8,enabled:true,color:'invalid',mode:'b'});
  assert.deepEqual(model.snapshot(),{size:3,enabled:true,color:'#000000',mode:'b'});
  const snapshot=model.snapshot();snapshot.size=99;assert.equal(model.snapshot().size,3);
  unsubscribe();model.set('size',7);assert.equal(changes.length,2);
  assert.throws(()=>model.set('unknown',2),/Unknown/);
});

test('fractional option steps retain defaults and malformed saved checkbox values restore defaults',()=>{
  const model=new ToolOptionsViewModel([{key:'amount',type:'number',min:.5,max:10.5,step:2,defaultValue:2.5},
    {key:'enabled',type:'checkbox',defaultValue:false}]);
  model.restore();assert.equal(model.snapshot().amount,2.5);
  assert.equal(model.set('amount',5.7),6.5);
  assert.equal(model.set('enabled','false'),false);
});

test('tool discovery isolates invalid manifests, traversal, reserved IDs, and duplicate folders',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameline-plugin-discovery-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dirs=[path.join(root,'app'),path.join(root,'user')];
  const write=async(directory,folder,manifest)=>{
    const target=path.join(directory,folder);await fs.mkdir(target,{recursive:true});
    await fs.writeFile(path.join(target,'plugin.json'),JSON.stringify(manifest));
    await fs.writeFile(path.join(target,'index.mjs'),'export default class Tool {}');
    await fs.writeFile(path.join(target,'processor.py'),'class Processor: pass');
  };
  const manifest={id:'sample-tool',name:'Sample',apiVersion:1,entry:'index.mjs',processor:'processor.py'};
  await write(dirs[0],'good',manifest);await write(dirs[1],'duplicate',manifest);
  await fs.writeFile(path.join(dirs[0],'outside.mjs'),'export default class {}');
  await write(dirs[0],'traversal',{...manifest,id:'traversal',entry:'../outside.mjs'});
  await write(dirs[0],'reserved',{...manifest,id:'brush'});
  await write(dirs[0],'old',{...manifest,id:'old',apiVersion:99});
  const service=new ToolPluginService([...dirs,path.join(root,'missing')]);
  const result=await service.discover();assert.equal(result.plugins.length,1);assert.equal(result.errors.length,4);
  assert.equal(result.plugins[0].processorAvailable,true);assert.ok(result.plugins[0].entryURL.startsWith('file:///'));
  assert.equal('processor' in result.plugins[0],false);
  assert.ok(service.processor('sample-tool').endsWith('processor.py'));
  assert.throws(()=>service.processor('unregistered'),/registered/);
  result.errors.length=0;assert.equal(service.list().errors.length,4,'callers cannot mutate discovery errors');
});

test('session state is separate from saved projects and media services are injectable',async()=>{
  const session=new EditorSessionViewModel(),application={};session.connect(application);
  application.previewTool='brush';assert.equal(session.previewTool,'brush');
  assert.equal(new EditorSessionViewModel().previewTool,'hand');
  const viewModel=new TimelineViewModel({inspectImages:async()=>[{path:'source.png',name:'Source',width:8,height:8}]});
  await viewModel.addImages(['source.png']);assert.equal(viewModel.project.images.length,1);
  assert.equal('previewTool' in viewModel.project,false);assert.equal(viewModel.canUndo,true);
});


test('temporary dialog handlers are removed together and disposal remains idempotent',()=>{
  const bindings=new EventBindings(),target=new EventTarget();let calls=0;
  bindings.listen(target,'change',()=>calls++);
  bindings.listen(target,'change',()=>calls++);
  target.dispatchEvent(new Event('change'));assert.equal(calls,2);
  bindings.dispose();bindings.dispose();target.dispatchEvent(new Event('change'));
  assert.equal(calls,2);assert.equal(bindings.entries.length,0);
});
