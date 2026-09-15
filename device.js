const { spawn, execFile } = require('child_process');

class DeviceBridge {
  constructor() {
    this.tunnelProcess = null;
    this.tunnelReady = false;
  }

  /**
   * Start pymobiledevice3 tunnel. Needs admin on Windows.
   * For iOS 17+, this creates a RemoteXPC tunnel.
   */
  startTunnel() {
    return new Promise((resolve, reject) => {
      if (this.tunnelProcess) {
        resolve({ alreadyRunning: true });
        return;
      }

      // Try userspace tunnel first (no admin needed on some setups)
      this.tunnelProcess = spawn('pymobiledevice3', ['remote', 'start-tunnel'], {
        shell: true
      });

      let output = '';
      let resolved = false;

      const doResolve = (result) => {
        if (!resolved) {
          resolved = true;
          this.tunnelReady = true;
          resolve(result);
        }
      };

      const doReject = (err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      };

      this.tunnelProcess.stdout.on('data', (data) => {
        output += data.toString();
        if (output.includes('tunnel') || output.includes('--rsd') || output.includes('created')) {
          doResolve({ ready: true, output: output.trim() });
        }
      });

      this.tunnelProcess.stderr.on('data', (data) => {
        output += data.toString();
        if (output.includes('tunnel') || output.includes('created')) {
          doResolve({ ready: true, output: output.trim() });
        }
      });

      this.tunnelProcess.on('error', (err) => {
        this.tunnelProcess = null;
        this.tunnelReady = false;
        doReject(new Error(`Failed to start tunnel: ${err.message}. Run: pip install pymobiledevice3`));
      });

      this.tunnelProcess.on('close', (code) => {
        this.tunnelProcess = null;
        this.tunnelReady = false;
        if (!resolved) {
          doReject(new Error(
            `Tunnel exited (code ${code}). Open an Admin terminal and run:\n` +
            `pymobiledevice3 remote start-tunnel\n` +
            `Keep it running, then try again.`
          ));
        }
      });

      // Assume ready after 10s if process still alive
      setTimeout(() => {
        if (!resolved && this.tunnelProcess) {
          doResolve({ ready: true, output: output.trim(), assumed: true });
        }
      }, 10000);
    });
  }

  stopTunnel() {
    if (this.tunnelProcess) {
      this.tunnelProcess.kill();
      this.tunnelProcess = null;
      this.tunnelReady = false;
    }
  }

  /**
   * Set simulated location. Uses --tunnel flag for iOS 17+ auto-discovery.
   */
  setLocation(lat, lng) {
    return new Promise((resolve, reject) => {
      const args = ['developer', 'dvt', 'simulate-location', 'set', '--tunnel', '', '--', String(lat), String(lng)];

      execFile('pymobiledevice3', args, { shell: true, timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          // If tunnel flag fails, try without it (iOS 16 and below)
          const fallbackArgs = ['developer', 'dvt', 'simulate-location', 'set', '--', String(lat), String(lng)];
          execFile('pymobiledevice3', fallbackArgs, { shell: true, timeout: 30000 }, (err2, out2, serr2) => {
            if (err2) {
              const msg = (stderr + '\n' + serr2).trim();
              if (msg.includes('no-root userspace tunnel') || msg.includes('Trying again')) {
                reject(new Error(
                  'No tunnel running. Open an Admin terminal and run:\n' +
                  'pymobiledevice3 remote start-tunnel\n' +
                  'Keep it running, then click Spoof again.'
                ));
              } else {
                reject(new Error(`Set location failed: ${msg || err2.message}`));
              }
              return;
            }
            resolve({ stdout: out2.trim(), stderr: serr2.trim() });
          });
          return;
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  /**
   * Clear simulated location.
   */
  clearLocation() {
    return new Promise((resolve, reject) => {
      const args = ['developer', 'dvt', 'simulate-location', 'clear', '--tunnel', ''];

      execFile('pymobiledevice3', args, { shell: true, timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          // Fallback without tunnel flag
          const fallbackArgs = ['developer', 'dvt', 'simulate-location', 'clear'];
          execFile('pymobiledevice3', fallbackArgs, { shell: true, timeout: 30000 }, (err2, out2, serr2) => {
            if (err2) {
              reject(new Error(`Clear location failed: ${(stderr + '\n' + serr2).trim() || err2.message}`));
              return;
            }
            resolve({ stdout: out2.trim(), stderr: serr2.trim() });
          });
          return;
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  /**
   * Check if pymobiledevice3 installed and device connected.
   */
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
