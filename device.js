const { spawn, execFile } = require('child_process');

class DeviceBridge {
  constructor() {
    this.tunnelProcess = null;
    this.tunnelReady = false;
  }

  /**
   * Start pymobiledevice3 tunnel for iOS 17+.
   * Uses `lockdown start-tunnel` (USB-based, reliable on Windows)
   * instead of `remote start-tunnel` (Bonjour-based, broken on Windows).
   */
  startTunnel() {
    return new Promise((resolve, reject) => {
      if (this.tunnelProcess) {
        resolve({ alreadyRunning: true });
        return;
      }

      // Use lockdown tunnel with --userspace to avoid WinTun driver issues
      this.tunnelProcess = spawn('pymobiledevice3', ['lockdown', 'start-tunnel', '--userspace'], {
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
        if (output.includes('tunnel') || output.includes('--rsd') || output.includes('created') || output.includes('address')) {
          doResolve({ ready: true, output: output.trim() });
        }
      });

      this.tunnelProcess.stderr.on('data', (data) => {
        output += data.toString();
        if (output.includes('tunnel') || output.includes('created') || output.includes('address')) {
          doResolve({ ready: true, output: output.trim() });
        }
      });

      this.tunnelProcess.on('error', (err) => {
        this.tunnelProcess = null;
        this.tunnelReady = false;
        doReject(new Error(`Failed to start tunnel: ${err.message}. Run: pip install -U pymobiledevice3`));
      });

      this.tunnelProcess.on('close', (code) => {
        this.tunnelProcess = null;
        this.tunnelReady = false;
        if (!resolved) {
          doReject(new Error(
            `Tunnel exited (code ${code}). Open Admin terminal and run:\n` +
            `pymobiledevice3 lockdown start-tunnel --userspace\n` +
            `Keep it running, then try again.\n\n${output}`
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
   * Set simulated location.
   * Tries direct command first (auto-tunnel for iOS 17.4+),
   * then falls back to explicit tunnel flag.
   */
  setLocation(lat, lng) {
    return this._runLocationCommand(['developer', 'dvt', 'simulate-location', 'set', '--', String(lat), String(lng)]);
  }

  /**
   * Clear simulated location.
   */
  clearLocation() {
    return this._runLocationCommand(['developer', 'dvt', 'simulate-location', 'clear']);
  }

  /**
   * Run a location command with auto-tunnel fallback chain.
   * Order: direct → --tunnel → helpful error message
   */
  _runLocationCommand(args) {
    return new Promise((resolve, reject) => {
      // Set env to prefer userspace tunnel auto-discovery
      const env = { ...process.env, PYMOBILEDEVICE3_DEFAULT_FALLBACK: 'userspace' };

      execFile('pymobiledevice3', args, { shell: true, timeout: 45000, env }, (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
          return;
        }

        // Check if it's a tunnel-related failure
        const combined = (stderr + '\n' + stdout).toLowerCase();
        if (combined.includes('tunnel') || combined.includes('no-root') || combined.includes('trying again')) {
          reject(new Error(
            'No tunnel running. Open an Admin terminal and run:\n' +
            'pymobiledevice3 lockdown start-tunnel --userspace\n' +
            'Keep it running, then click Spoof again.'
          ));
        } else {
          reject(new Error(`Command failed: ${stderr.trim() || error.message}`));
        }
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
