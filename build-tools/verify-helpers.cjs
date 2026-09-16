const fs = require('fs');
const path = require('path');
module.exports = async context => {
  const mac = context.electronPlatformName === 'darwin';
  const extension = mac ? '' : '.exe';
  for (const name of ['pymobiledevice3', 'ghost_spoofer']) {
    const file = path.join(context.packager.projectDir, 'resources', name + extension);
    if (!fs.existsSync(file)) throw new Error('Missing native helper: ' + file + '. Run build-tools/build_helpers.py on the target OS first.');
    const header = fs.readFileSync(file).subarray(0, 8);
    if (mac) {
      if (header.readUInt32LE(0) !== 0xfeedfacf) throw new Error(name + ' must be a native 64-bit Mach-O executable, not a renamed Windows .exe.');
      const wanted = context.arch === 3 ? 0x0100000c : 0x01000007;
      if (header.readUInt32LE(4) !== wanted) throw new Error(name + ' was built for the wrong Mac CPU. Build on a matching native runner.');
      fs.accessSync(file, fs.constants.X_OK);
    } else if (header.toString('ascii', 0, 2) !== 'MZ') {
      throw new Error(name + ' is not a Windows executable.');
    }
  }
};

