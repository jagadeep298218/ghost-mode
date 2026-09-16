const fs=require('fs');
const path=require('path');
(async()=>{
 const repo=process.argv[2];
 if(!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw Error('Usage: node build-tools/configure-downloads.cjs OWNER/REPO');
 const names={windows:'Ghost-Mode-Windows-x64.exe',macArm64:'Ghost-Mode-macOS-arm64.dmg',macX64:'Ghost-Mode-macOS-x64.dmg'};
 const downloads={};
 for(const [key,name] of Object.entries(names)){
  const url='https://github.com/'+repo+'/releases/latest/download/'+name;
  const response=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Release asset unavailable ('+response.status+'): '+url);
  downloads[key]={url,available:true};
 }
 const site=path.join(__dirname,'../docs/website');
 fs.writeFileSync(path.join(site,'downloads-config.js'),'// Verified published release assets.\nwindow.GHOST_DOWNLOADS = '+JSON.stringify(downloads,null,2)+';\n');
 const html=fs.readFileSync(path.join(site,'index.html'),'utf8').replaceAll('https://github.com/AnonAmit/ghost-mode','https://github.com/'+repo);
 fs.writeFileSync(path.join(site,'index.html'),html);
 console.log('Verified all three downloads and updated the website for '+repo);
})().catch(error=>{console.error(error.message);process.exitCode=1});

