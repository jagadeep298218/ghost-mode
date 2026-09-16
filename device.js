const { spawn, execFile } = require('child_process');

class DeviceBridge {
  constructor() {
    this.rsdHost = null;
    this.rsdPort = null;
    this.tunnelProcess = null;
    this.spoofProcess = null;
    this.jitterInterval = null;
    this.currentLat = null;
    this.currentLng = null;
  }

  setRsd(host, port) {
    this.rsdHost = host;
    this.rsdPort = port;
  }

  hasRsd() {
    return this.rsdHost && this.rsdPort;
  }

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
        const match = output.match(/--rsd\s+(\S+)\s+(\d+)/);
        if (match) doResolve(match[1], match[2]);
      };

      this.tunnelProcess.stdout.on('data', (data) => { output += data.toString(); checkOutput(); });
      this.tunnelProcess.stderr.on('data', (data) => { output += data.toString(); checkOutput(); });

      this.tunnelProcess.on('error', (err) => {
        this.tunnelProcess = null;
        if (!resolved) { resolved = true; reject(new Error(`Tunnel failed: ${err.message}`)); }
      });

      this.tunnelProcess.on('close', (code) => {
        this.tunnelProcess = null;
        if (!resolved) {
          resolved = true;
          reject(new Error(`Tunnel exited (code ${code}). Run as Administrator.`));
        }
      });

      setTimeout(() => {
        if (!resolved) { resolved = true; reject(new Error('Tunnel timed out.')); }
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
   * Set location and KEEP the DVT channel alive.
   * Also starts GPS jitter to simulate natural drift.
   */
  setLocation(lat, lng) {
    if (!this.hasRsd()) {
      return Promise.reject(new Error('No RSD connection. Enter tunnel host:port first.'));
    }

    // Kill any existing spoof process
    this.stopSpoofing();

    this.currentLat = lat;
    this.currentLng = lng;

    return new Promise((resolve, reject) => {
      const args = [
        'developer', 'dvt', 'simulate-location', 'set',
        '--rsd', this.rsdHost, this.rsdPort,
        '--', String(lat), String(lng)
      ];

      this.spoofProcess = spawn('pymobiledevice3', args, { shell: true });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const doResolve = () => {
        if (!resolved) {
          resolved = true;
          // DON'T kill the process — keep DVT channel alive
          this._startJitter();
          resolve({ success: true });
        }
      };

      const doReject = (msg) => {
        if (!resolved) {
          resolved = true;
          this.stopSpoofing();
          reject(new Error(msg));
        }
      };

      this.spoofProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.includes('Press ENTER') || stdout.includes('press enter')) {
          doResolve();
        }
      });

      this.spoofProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      this.spoofProcess.on('close', (code) => {
        if (resolved) {
          // Process died after we resolved — spoof may have ended
          this.spoofProcess = null;
          this._stopJitter();
          return;
        }
        if (code === 0) {
          doResolve();
        } else {
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

      this.spoofProcess.on('error', (err) => {
        doReject(`Failed to run pymobiledevice3: ${err.message}`);
      });

      setTimeout(() => {
        doReject('Command timed out (60s).');
      }, 60000);
    });
  }

  /**
   * Start GPS jitter — every 5 seconds, re-set location with slight random drift.
   * This makes the location look natural to apps like Life360.
   */
  _startJitter() {
    this._stopJitter();

    this.jitterInterval = setInterval(() => {
      if (!this.spoofProcess || !this.currentLat) return;

      // Random drift: ~2-5 meters in each direction
      const jitterLat = (Math.random() - 0.5) * 0.00005;
      const jitterLng = (Math.random() - 0.5) * 0.00005;
      const lat = this.currentLat + jitterLat;
      const lng = this.currentLng + jitterLng;

      // Fire and forget — spawn a quick set command
      const args = [
        'developer', 'dvt', 'simulate-location', 'set',
        '--rsd', this.rsdHost, this.rsdPort,
        '--', String(lat), String(lng)
      ];

      const jitterProc = spawn('pymobiledevice3', args, { shell: true });

      // Auto-dismiss "Press ENTER" and kill after brief delay
      let jitterOut = '';
      jitterProc.stdout.on('data', (data) => {
        jitterOut += data.toString();
        if (jitterOut.includes('Press ENTER')) {
          try { jitterProc.stdin.write('\n'); } catch (e) {}
          setTimeout(() => { try { jitterProc.kill(); } catch (e) {} }, 500);
        }
      });

      // Kill after 30s max
      setTimeout(() => { try { jitterProc.kill(); } catch (e) {} }, 30000);
    }, 8000); // Every 8 seconds
  }

  _stopJitter() {
    if (this.jitterInterval) {
      clearInterval(this.jitterInterval);
      this.jitterInterval = null;
    }
  }

  /**
   * Stop spoofing — kill process, stop jitter, clear location.
   */
  stopSpoofing() {
    this._stopJitter();
    if (this.spoofProcess) {
      try { this.spoofProcess.stdin.write('\n'); } catch (e) {}
      setTimeout(() => {
        try { this.spoofProcess.kill(); } catch (e) {}
        this.spoofProcess = null;
      }, 500);
    }
  }

  /**
   * Clear simulated location and stop everything.
   */
  clearLocation() {
    this.stopSpoofing();

    if (!this.hasRsd()) {
      return Promise.reject(new Error('No RSD connection.'));
    }

    return new Promise((resolve, reject) => {
      const args = [
        'developer', 'dvt', 'simulate-location', 'clear',
        '--rsd', this.rsdHost, this.rsdPort
      ];

      const proc = spawn('pymobiledevice3', args, { shell: true });
      let stdout = '';
      let resolved = false;

      const done = () => {
        if (!resolved) {
          resolved = true;
          try { proc.stdin.write('\n'); } catch (e) {}
          setTimeout(() => { try { proc.kill(); } catch (e) {} }, 500);
          this.currentLat = null;
          this.currentLng = null;
          resolve({ success: true });
        }
      };

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.includes('Press ENTER')) done();
      });

      proc.on('close', (code) => {
        if (!resolved) {
          if (code === 0) done();
          else { resolved = true; reject(new Error(`Clear failed (code ${code})`)); }
        }
      });

      proc.on('error', (err) => {
        if (!resolved) { resolved = true; reject(new Error(err.message)); }
      });

      setTimeout(() => {
        if (!resolved) { resolved = true; proc.kill(); resolve({ success: true }); }
      }, 30000);
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
    this.stopSpoofing();
    this.stopTunnel();
  }
}

module.exports = DeviceBridge;
