const { spawn } = require("child_process");
const path = require("path");
// replicate terminalCommand exactly
const scriptAbs = path.join(process.cwd(), "Build","Scripts","start-hermes.ps1");
const child = spawn("cmd.exe", ["/c","start",'"AI Agent U盘版"',"powershell.exe",
  "-NoProfile","-ExecutionPolicy","Bypass","-File", scriptAbs], {detached:true, stdio:"ignore"});
child.unref();
console.log("spawned pid", child.pid);
