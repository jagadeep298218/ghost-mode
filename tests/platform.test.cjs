const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const source=fs.readFileSync(path.join(__dirname,'../device.js'),'utf8');
function harness(platform, existing=()=>true) {
 const calls=[],children=[],timers=new Set();
 const makeChild=()=>{const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.stdin={write(){}};p.kill=()=>{p.killed=true};children.push(p);return p;};
 const childProcess={
  spawn:(cmd,args,options)=>{calls.push({kind:'spawn',cmd,args,options});return makeChild();},
  exec:(cmd,options,cb)=>{calls.push({kind:'exec',cmd});if(typeof options==='function')options(null,'','');else if(cb)cb(null,'UniqueDeviceID true','');},
  execFile:(cmd,args,options,cb)=>{calls.push({kind:'execFile',cmd,args});cb(null,'UniqueDeviceID true','');}
 };
 const mockedFs={existsSync:existing,unlinkSync(){},writeFileSync:(file,data)=>calls.push({kind:'write',file,data}),readFileSync:()=>''};
 const sandbox={module:{exports:{}},exports:{},require:name=>({'child_process':childProcess,fs:mockedFs,os:{tmpdir:()=>'/tmp'},path:path.posix}[name]||require(name)),process:{platform,env:{},resourcesPath:'/Applications/Ghost Mode.app/Contents/Resources'},__dirname:'/project',console:{log(){}},setTimeout:cb=>{timers.add(cb);return cb;},clearTimeout:cb=>timers.delete(cb),setInterval:cb=>{timers.add(cb);return cb},clearInterval:cb=>timers.delete(cb)};
 vm.runInNewContext(source,sandbox);
 return {bridge:new sandbox.module.exports(),calls,children,timers};
}
test('Mac skips Windows drivers and resolves native helper paths',async()=>{
 const h=harness('darwin');
 assert.equal((await h.bridge.checkiTunes()).installed,true);
 assert.equal(h.calls.length,0);
 assert.equal(h.bridge._getSpooferCmd().cmd,'/Applications/Ghost Mode.app/Contents/Resources/ghost_spoofer');
});
test('Windows keeps .exe helpers and driver checks',async()=>{
 const h=harness('win32');await h.bridge.checkiTunes();
 assert.equal(h.calls[0].cmd,'sc query AppleMobileDeviceService');
 assert.match(h.bridge._getSpooferCmd().cmd,/ghost_spoofer\.exe$/);
});
test('Mac dev fallback uses python3; Windows uses python',()=>{
 for(const [platform,expected] of [['darwin','python3'],['win32','python']]){
 const h=harness(platform,p=>p.endsWith('.py'));assert.equal(h.bridge._getSpooferCmd().cmd,expected);
 }
});
test('Mac tunnel uses direct spawn, shares pending connection, parses fragmented output',async()=>{
 const h=harness('darwin');const ready=h.bridge.startTunnelElevated();
 assert.equal(h.bridge.startTunnelElevated(),ready);
 assert.equal(h.calls.length,1);
 assert.deepEqual(Array.from(h.calls[0].args),['remote','start-tunnel']);
 assert.equal(h.calls[0].options.shell,false);
 assert.match(h.calls[0].cmd,/Resources\/pymobiledevice3$/);
 const child=h.children[0];
 child.stdout.emit('data','--rsd fd20::1 64');
 assert.equal(h.bridge.hasRsd(),null);
 child.stdout.emit('data','337\n');
 const r=await ready;assert.equal(r.port,'64337');assert.equal(r.host,'fd20::1');
 assert.equal(h.timers.size,0);
 assert.equal((await h.bridge.startTunnelElevated()).alreadyRunning,true);
 child.emit('close',0);assert.equal(h.bridge.hasRsd(),null);
 h.bridge.stopTunnel();assert.equal(h.calls.some(c=>/taskkill|powershell/.test(c.cmd||'')),false);
});
test('Mac tunnel accepts RSD address/port lines and clears state on stop',async()=>{
 const h=harness('darwin');const pending=h.bridge.startTunnelElevated();
 h.children[0].stderr.emit('data','RSD Address: fd42::1\nRSD Port: 50123\n');
 assert.equal((await pending).port,'50123');h.bridge.stopTunnel();
 assert.equal(h.children[0].killed,true);assert.equal(h.bridge.hasRsd(),null);
});
test('Failed or timed-out tunnels can be retried without stale processes',async()=>{
 const h=harness('darwin');const failed=h.bridge.startTunnelElevated();h.children[0].emit('error',new Error('ENOENT'));
 await assert.rejects(failed,/ENOENT/);assert.equal(h.children[0].killed,true);
 const timed=h.bridge.startTunnelElevated();[...h.timers][0]();await assert.rejects(timed,/timed out/);
 assert.equal(h.children[1].killed,true);assert.equal(h.bridge.hasRsd(),null);
 const stopped=h.bridge.startTunnelElevated();h.bridge.stopTunnel();await assert.rejects(stopped,/stopped/);
});
test('Windows elevated tunnel still writes lockdown command and uses UAC',()=>{
 const h=harness('win32');h.bridge.startTunnelElevated();
 assert.match(h.calls.find(c=>c.kind==='write').data,/pymobiledevice3\.exe.*lockdown start-tunnel/);
 assert.match(h.calls.find(c=>c.kind==='exec').cmd,/powershell.*RunAs/);
 h.bridge.stopTunnel();assert.ok(h.calls.some(c=>c.cmd==='taskkill /F /IM pymobiledevice3.exe'));
});
test('Shared device commands use argument arrays on both platforms',async()=>{
 for(const platform of ['darwin','win32']){
 const h=harness(platform);await h.bridge.autoMount();await h.bridge.checkStatus();await h.bridge.checkDevMode();await h.bridge.enableDevMode();
 const commands=h.calls.filter(c=>c.kind==='execFile').map(c=>Array.from(c.args).join(' '));
 assert.deepEqual(commands,['mounter auto-mount','usbmux list','amfi developer-mode-status','amfi enable-developer-mode']);
 }
});
test('Packaging keeps Windows and Mac helper files separate',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
 assert.equal(pkg.build.extraResources,undefined);
 assert.ok(pkg.build.win.extraResources.every(r=>r.from.endsWith('.exe')));
 assert.ok(pkg.build.mac.extraResources.every(r=>!r.from.endsWith('.exe')));
 assert.deepEqual(pkg.build.mac.target,['dmg','zip']);
});

