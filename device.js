const { spawn, execFile } = require('child_process');

class DeviceBridge {
  constructor() {
    this.tunnelProcess = null;
    this.tunnelReady = false;
  }

  /**
   * Start pymobiledevice3 tunnel for iOS 17+.
   * Uses lockdown (USB-based) instead of remote (Bonjour-based).
   */
  startTunnel() {
    return new Promise((resolve, reject) => {
      if (this.tunnelProcess) {
        resolve({ alreadyRunning: true });
        return;
      }

      this.tunnelProcess = spawn('pymobiledevice3', ['lockdown', 'start-tunnel'], {
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
      });

      this.tunnelProcess.stderr.on('data', (data) => {
        output += data.toString();
      });

      this.tunnelProcess.on('error', (err) => {
        this.tunnelProcess = null;
        this.tunnelReady = false;
        doReject(new Error(`Failed to start tunnel: ${err.message}`));
      });

      this.tunnelProcess.on('close', (code) => {
        this.tunnelProcess = null;
        this.tunnelReady = false;
        if (!resolved) {
          doReject(new Error(`Tunnel exited (code ${code}).\n${output}`));
        }
      });

      // Assume ready after 8s if process still alive
      setTimeout(() => {
        if (!resolved && this.tunnelProcess) {
          doResolve({ ready: true, output: output.trim(), assumed: true });
        }
      }, 8000);
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
   * Set simulated location using spawn (not execFile) so pymobiledevice3
   * can auto-tunnel in-process for iOS 17+. This takes 10-20 seconds
   * as it establishes its own userspace tunnel.
   */
  setLocation(lat, lng) {
    return this._runLocationCommand(['developer', 'dvt', 'simulate-location', 'set', '--', String(lat), String(lng)]);
  }

  clearLocation() {
    return this._runLocationCommand(['developer', 'dvt', 'simulate-location', 'clear']);
  }

  /**
   * Run a pymobiledevice3 developer command using spawn.
   * Lets the process auto-create a userspace tunnel in-process.
   * Waits for process to exit, captures all output.
   */
  _runLocationCommand(args) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, PYMOBILEDEVICE3_DEFAULT_FALLBACK: 'userspace' };

      const proc = spawn('pymobiledevice3', args, {
        shell: true,
        env
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (timedOut) return;

        if (code === 0) {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        } else {
          const combined = stderr + stdout;
          // Filter out deprecation warnings and info logs to get actual error
          const lines = combined.split('\n').filter(l =>
            !l.includes('RequestsDependencyWarning') &&
            !l.includes('warnings.warn') &&
            !l.includes('DeprecationWarning') &&
            !l.includes('datetime.datetime') &&
            !l.includes('requests/__init__') &&
            !l.includes('dateutil/tz') &&
            l.trim().length > 0
          );
          const cleanError = lines.join('\n').trim();
          reject(new Error(cleanError || `Command failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        if (timedOut) return;
        reject(new Error(`Failed to run pymobiledevice3: ${err.message}`));
      });

      // 60 second timeout — auto-tunnel can take 15-20 seconds
      setTimeout(() => {
        if (proc.exitCode === null) {
          timedOut = true;
          proc.kill();
          reject(new Error('Command timed out (60s). Make sure iPhone is connected and Developer Mode is on.'));
        }
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
