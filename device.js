const { spawn, execFile } = require('child_process');

class DeviceBridge {
  constructor() {
    this.tunnelProcess = null;
    this.tunnelReady = false;
  }

  startTunnel() {
    return new Promise((resolve, reject) => {
      if (this.tunnelProcess) {
        resolve({ alreadyRunning: true });
        return;
      }

      this.tunnelProcess = spawn('pymobiledevice3', ['remote', 'start-tunnel'], {
        shell: true
      });

      let output = '';

      this.tunnelProcess.stdout.on('data', (data) => {
        output += data.toString();
        if (output.includes('tunnel') || output.includes('--rsd')) {
          this.tunnelReady = true;
          resolve({ ready: true, output: output.trim() });
        }
      });

      this.tunnelProcess.stderr.on('data', (data) => {
        output += data.toString();
        if (output.includes('tunnel') || output.includes('created')) {
          this.tunnelReady = true;
          resolve({ ready: true, output: output.trim() });
        }
      });

      this.tunnelProcess.on('error', (err) => {
        this.tunnelProcess = null;
        this.tunnelReady = false;
        reject(new Error(`Failed to start tunnel: ${err.message}. Is pymobiledevice3 installed? Run: pip install pymobiledevice3`));
      });

      this.tunnelProcess.on('close', (code) => {
        this.tunnelProcess = null;
        this.tunnelReady = false;
        if (!this.tunnelReady) {
          reject(new Error(`Tunnel exited with code ${code}. Make sure to run the app as Administrator.\n${output}`));
        }
      });

      setTimeout(() => {
        if (!this.tunnelReady && this.tunnelProcess) {
          this.tunnelReady = true;
          resolve({ ready: true, output: output.trim(), assumed: true });
        }
      }, 15000);
    });
  }

  stopTunnel() {
    if (this.tunnelProcess) {
      this.tunnelProcess.kill();
      this.tunnelProcess = null;
      this.tunnelReady = false;
    }
  }

  setLocation(lat, lng) {
    return new Promise((resolve, reject) => {
      const args = ['developer', 'dvt', 'simulate-location', 'set', '--', String(lat), String(lng)];

      execFile('pymobiledevice3', args, { shell: true, timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Set location failed: ${stderr || error.message}`));
          return;
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  clearLocation() {
    return new Promise((resolve, reject) => {
      const args = ['developer', 'dvt', 'simulate-location', 'clear'];

      execFile('pymobiledevice3', args, { shell: true, timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Clear location failed: ${stderr || error.message}`));
          return;
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  checkStatus() {
    return new Promise((resolve) => {
      execFile('pymobiledevice3', ['usbmux', 'list'], { shell: true, timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ installed: false, connected: false, error: error.message });
          return;
        }
        const hasDevice = stdout.includes('UniqueDeviceID') || stdout.includes('DeviceName');
        resolve({ installed: true, connected: hasDevice, output: stdout.trim() });
      });
    });
  }

  destroy() {
    this.stopTunnel();
  }
}

module.exports = DeviceBridge;
