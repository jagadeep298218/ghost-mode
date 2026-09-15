const { spawn, execFile } = require('child_process');

class DeviceBridge {
  constructor() {
    this.rsdHost = null;
    this.rsdPort = null;
    this.tunnelProcess = null;
  }

  /**
   * Set RSD address from user input or tunnel output.
   */
  setRsd(host, port) {
    this.rsdHost = host;
    this.rsdPort = port;
  }

  hasRsd() {
    return this.rsdHost && this.rsdPort;
  }

  /**
   * Start tunnel and parse RSD host/port from output.
   * Requires admin privileges.
   */
  startTunnel() {
    return new Promise((resolve, reject) => {
      if (this.tunnelProcess) {
        resolve({ alreadyRunning: true, host: this.rsdHost, port: this.rsdPort });
        return;
      }

      this.tunnelProcess = spawn('pymobiledevice3', ['remote', 'start-tunnel'], {
        shell: true
      });

      let output = '';
      let resolved = false;

      const doResolve = (host, port) => {
        if (!resolved) {
          resolved = true;
          this.rsdHost = host;
          this.rsdPort = port;
          resolve({ ready: true, host, port });
        }
      };

      const checkOutput = () => {
        // Parse "--rsd HOST PORT" from output
        const match = output.match(/--rsd\s+(\S+)\s+(\d+)/);
        if (match) {
          doResolve(match[1], match[2]);
        }
      };

      this.tunnelProcess.stdout.on('data', (data) => {
        output += data.toString();
        checkOutput();
      });

      this.tunnelProcess.stderr.on('data', (data) => {
        output += data.toString();
        checkOutput();
      });

      this.tunnelProcess.on('error', (err) => {
        this.tunnelProcess = null;
        if (!resolved) {
          resolved = true;
          reject(new Error(`Tunnel failed: ${err.message}`));
        }
      });

      this.tunnelProcess.on('close', (code) => {
        this.tunnelProcess = null;
        if (!resolved) {
          resolved = true;
          reject(new Error(
            `Tunnel exited (code ${code}). Run as Administrator.\n` +
            `Or start tunnel manually in admin terminal:\n` +
            `pymobiledevice3 remote start-tunnel`
          ));
        }
      });

      // Timeout after 20s
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Tunnel timed out. Start it manually in admin terminal:\npymobiledevice3 remote start-tunnel'));
        }
      }, 20000);
    });
  }

  stopTunnel() {
    if (this.tunnelProcess) {
      this.tunnelProcess.kill();
      this.tunnelProcess = null;
    }
  }

  /**
   * Set simulated location using --rsd flag.
   */
  setLocation(lat, lng) {
    if (!this.hasRsd()) {
      return Promise.reject(new Error('No RSD connection. Enter tunnel host:port or start tunnel first.'));
    }
    return this._runCommand([
      'developer', 'dvt', 'simulate-location', 'set',
      '--rsd', this.rsdHost, this.rsdPort,
      '--', String(lat), String(lng)
    ]);
  }

  /**
   * Clear simulated location.
   */
  clearLocation() {
    if (!this.hasRsd()) {
      return Promise.reject(new Error('No RSD connection.'));
    }
    return this._runCommand([
      'developer', 'dvt', 'simulate-location', 'clear',
      '--rsd', this.rsdHost, this.rsdPort
    ]);
  }

  /**
   * Run pymobiledevice3 command, handle "Press ENTER" prompt.
   */
  _runCommand(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn('pymobiledevice3', args, { shell: true });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const doResolve = () => {
        if (!resolved) {
          resolved = true;
          try { proc.stdin.write('\n'); } catch (e) {}
          setTimeout(() => { try { proc.kill(); } catch (e) {} }, 500);
          resolve({ success: true, stdout: stdout.trim() });
        }
      };

      const doReject = (msg) => {
        if (!resolved) {
          resolved = true;
          try { proc.kill(); } catch (e) {}
          reject(new Error(msg));
        }
      };

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.includes('Press ENTER') || stdout.includes('press enter')) {
          doResolve();
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (resolved) return;
        if (code === 0) {
          doResolve();
        } else {
          // Clean up error output
          const lines = (stderr + stdout).split('\n').filter(l =>
            !l.includes('RequestsDependencyWarning') &&
            !l.includes('warnings.warn') &&
            !l.includes('DeprecationWarning') &&
            !l.includes('datetime.datetime') &&
            !l.includes('requests/__init__') &&
            !l.includes('dateutil/tz') &&
            l.trim().length > 0
          );
          doReject(lines.join('\n').trim() || `Command failed (code ${code})`);
        }
      });

      proc.on('error', (err) => {
        doReject(`Failed to run pymobiledevice3: ${err.message}`);
      });

      setTimeout(() => {
        doReject('Command timed out (60s). Check iPhone connection and Developer Mode.');
      }, 60000);
    });
  }

  checkStatus() {
    return new Promise((resolve) => {
      execFile('pymobiledevice3', ['usbmux', 'list'], { shell: true, timeout: 10000 }, (error, stdout) => {
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
