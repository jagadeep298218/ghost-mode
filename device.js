const { spawn, execFile, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Get path to pymobiledevice3 executable.
 * Uses bundled exe in production, falls back to system install in dev.
 */
let _pmd3Cache = null;
const executableName = name => process.platform === 'win32' ? name + '.exe' : name;

function getPmd3Path() {
  if (_pmd3Cache) return _pmd3Cache;

  const candidates = [];

  // Packaged app — process.resourcesPath is the app's resources dir
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, executableName('pymobiledevice3')));
  }

  // Portable exe
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'resources', executableName('pymobiledevice3')));
  }

  // Dev mode — relative to project root
  candidates.push(path.join(__dirname, 'resources', executableName('pymobiledevice3')));

  // Log all candidates for debugging
  console.log('[Ghost Mode] resourcesPath:', process.resourcesPath);
  console.log('[Ghost Mode] __dirname:', __dirname);
  console.log('[Ghost Mode] Searching for pymobiledevice3 in:');
  for (const p of candidates) {
    const exists = fs.existsSync(p);
    console.log(`  ${exists ? 'FOUND' : 'MISS'}  ${p}`);
    if (exists) {
      _pmd3Cache = p;
      return p;
    }
  }

  console.log('[Ghost Mode] Falling back to system pymobiledevice3');
  _pmd3Cache = 'pymobiledevice3';
  return _pmd3Cache;
}

function getPmd3Quoted() {
  const p = getPmd3Path();
  return p.includes(' ') ? `"${p}"` : p;
}

class DeviceBridge {
  constructor() {
    this.rsdHost = null;
    this.rsdPort = null;
    this.tunnelProcess = null;
    this.spoofProcess = null;
    this.currentLat = null;
    this.currentLng = null;
    this.tunnelOutputFile = path.join(os.tmpdir(), 'ghost-mode-tunnel.txt');
    this.tunnelScriptFile = path.join(os.tmpdir(), 'ghost-mode-tunnel.bat');
    this.tunnelWatcher = null;
  }

  setRsd(host, port) {
    this.rsdHost = host;
    this.rsdPort = port;
  }

  hasRsd() {
    return this.rsdHost && this.rsdPort;
  }

  /**
   * Auto-mount DeveloperDiskImage (needed for iOS 17+).
   */
  autoMount() {
    return new Promise((resolve) => {
      const pmd3 = getPmd3Path();

      execFile(pmd3, ["mounter","auto-mount"], { timeout: 30000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, error: error.message });
        } else {
          resolve({ ok: true, output: (stdout + (stderr || '')).trim() });
        }
      });
    });
  }

  /**
   * Start tunnel with admin elevation via UAC prompt.
   * Writes output to temp file, watches for RSD host:port.
   */
  startTunnelElevated() {
    if (process.platform === 'darwin') return this.startTunnel();
    return new Promise((resolve, reject) => {
      if (this.rsdHost && this.rsdPort) {
        resolve({ alreadyRunning: true, host: this.rsdHost, port: this.rsdPort });
        return;
      }

      // Clean up old output file
      try { fs.unlinkSync(this.tunnelOutputFile); } catch (e) {}

      // Create batch script that runs tunnel and redirects output
      const scriptContent = `@echo off\r\n${getPmd3Quoted()} lockdown start-tunnel > "${this.tunnelOutputFile}" 2>&1\r\n`;
      fs.writeFileSync(this.tunnelScriptFile, scriptContent);

      // Launch elevated via PowerShell Start-Process -Verb RunAs
      const psCommand = `Start-Process -Verb RunAs -FilePath 'cmd.exe' -ArgumentList '/c,"${this.tunnelScriptFile}"' -WindowStyle Minimized`;

      exec(`powershell -Command "${psCommand}"`, (error) => {
        if (error) {
          reject(new Error(`UAC denied or failed: ${error.message}`));
          return;
        }

        // UAC accepted — now watch the output file for RSD info
        let resolved = false;
        let pollCount = 0;
        const maxPolls = 60; // 30 seconds max

        const pollFile = setInterval(() => {
          pollCount++;

          try {
            if (!fs.existsSync(this.tunnelOutputFile)) {
              if (pollCount > maxPolls) {
                clearInterval(pollFile);
                if (!resolved) { resolved = true; reject(new Error('Tunnel timed out. Check if pymobiledevice3 is installed.')); }
              }
              return;
            }

            const content = fs.readFileSync(this.tunnelOutputFile, 'utf-8');
            // Match either "--rsd HOST PORT" or "host: HOST\n...port: PORT" formats
            let match = content.match(/--rsd\s+(\S+)\s+(\d+)/);
            if (!match) {
              const hostMatch = content.match(/host[:\s]+(\S+)/i);
              const portMatch = content.match(/port[:\s]+(\d+)/i);
              if (hostMatch && portMatch) {
                match = [null, hostMatch[1], portMatch[1]];
              }
            }

            if (match) {
              clearInterval(pollFile);
              if (!resolved) {
                resolved = true;
                this.rsdHost = match[1];
                this.rsdPort = match[2];
                resolve({ ready: true, host: match[1], port: match[2] });
              }
            } else if (pollCount > maxPolls) {
              clearInterval(pollFile);
              if (!resolved) {
                resolved = true;
                const errMsg = content.trim() || 'Tunnel timed out — no RSD info found.';
                reject(new Error(errMsg));
              }
            }
          } catch (e) {
            // File not ready yet, keep polling
          }
        }, 500);

        this.tunnelWatcher = pollFile;
      });
    });
  }

  startTunnel() {
    if (this._tunnelStarting) return this._tunnelStarting;
    if (this.tunnelProcess && this.hasRsd()) {
      return Promise.resolve({ alreadyRunning: true, host: this.rsdHost, port: this.rsdPort });
    }

    const starting = new Promise((resolve, reject) => {
      const command = process.platform === 'win32' ? 'lockdown' : 'remote';
      const child = spawn(getPmd3Path(), [command, 'start-tunnel'], {
        shell: false, windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
      this.tunnelProcess = child;
      let output = '';
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._cancelTunnelStart = null;
        if (this.tunnelProcess === child) {
          this.tunnelProcess = null;
          this.rsdHost = null;
          this.rsdPort = null;
        }
        child.kill();
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error('Tunnel timed out. Reconnect and unlock your iPhone, then try again.')), 30000);
      this._cancelTunnelStart = () => fail(new Error('Tunnel stopped.'));
      const read = (data) => {
        output = (output + data.toString()).slice(-65536);
        if (settled) return;
        const clean = output.slice(0, output.lastIndexOf('\n') + 1).replace(/\x1b\[[0-9;]*m/g, '');
        let match = clean.match(/--rsd\s+(\S+)\s+(\d+)(?=\s|$)/);
        if (!match) {
          const host = clean.match(/(?:RSD Address|host)\s*:\s*(\S+)/i);
          const port = clean.match(/(?:RSD Port|port)\s*:\s*(\d+)(?=\s|$)/i);
          if (host && port) match = [null, host[1], port[1]];
        }
        if (!match) return;
        this.rsdHost = match[1];
        this.rsdPort = match[2];
        settled = true;
        clearTimeout(timer);
        this._cancelTunnelStart = null;
        resolve({ ready: true, host: match[1], port: match[2] });
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.on('error', error => fail(new Error('Tunnel failed: ' + error.message)));
      child.on('close', code => {
        if (this.tunnelProcess === child) {
          this.tunnelProcess = null;
          this.rsdHost = null;
          this.rsdPort = null;
        }
        fail(new Error('Tunnel exited (code ' + code + '). ' + (output.trim() || 'Reconnect your iPhone and try again.')));
      });
    });
    this._tunnelStarting = starting;
    const clearStarting = () => { if (this._tunnelStarting === starting) this._tunnelStarting = null; };
    starting.then(clearStarting, clearStarting);
    return starting;
  }


  stopTunnel() {
    if (this.tunnelWatcher) {
      clearInterval(this.tunnelWatcher);
      this.tunnelWatcher = null;
    }
    if (this.tunnelProcess) {
      this.tunnelProcess.kill();
      this.tunnelProcess = null;
    }
    if (this._cancelTunnelStart) this._cancelTunnelStart();
    this.rsdHost = null;
    this.rsdPort = null;
    // Only Windows starts a detached elevated helper.
    if (process.platform === 'win32') exec('taskkill /F /IM pymobiledevice3.exe', () => {});
  }

  /**
   * Get path to ghost_spoofer bundled exe or Python script.
   */
  _getSpooferCmd() {
    // Check for bundled ghost_spoofer.exe
    const candidates = [];
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, executableName('ghost_spoofer')));
    }
    candidates.push(path.join(__dirname, 'resources', executableName('ghost_spoofer')));

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return { cmd: p, args: [], useShell: false };
      }
    }

    // Dev mode — run Python script directly
    const scriptPath = path.join(__dirname, 'build-tools', 'ghost_spoofer.py');
    if (fs.existsSync(scriptPath)) {
      return { cmd: process.platform === 'win32' ? 'python' : 'python3', args: [scriptPath], useShell: false };
    }

    return null;
  }

  /**
   * Set location using a single persistent DVT channel.
   * Launches ghost_spoofer process which holds the channel open
   * and handles jitter internally — no more spawning multiple processes.
   */
  setLocation(lat, lng) {
    if (!this.hasRsd()) {
      return Promise.reject(new Error('No RSD connection. Enter tunnel host:port first.'));
    }

    this.currentLat = lat;
    this.currentLng = lng;

    // If spoofer already running, just send new coordinates
    if (this.spoofProcess && !this.spoofProcess.killed) {
      return new Promise((resolve, reject) => {
        try {
          this.spoofProcess.stdin.write(`set ${lat} ${lng}\n`);

          // Wait for OK response
          const onData = (data) => {
            const msg = data.toString().trim();
            if (msg.startsWith('OK set')) {
              this.spoofProcess.stdout.removeListener('data', onData);
              resolve({ success: true });
            } else if (msg.startsWith('ERROR')) {
              this.spoofProcess.stdout.removeListener('data', onData);
              reject(new Error(msg));
            }
          };
          this.spoofProcess.stdout.on('data', onData);

          setTimeout(() => {
            this.spoofProcess.stdout.removeListener('data', onData);
            resolve({ success: true }); // Assume it worked
          }, 10000);
        } catch (e) {
          // Process died, start fresh
          this.spoofProcess = null;
          return this._startSpoofer(lat, lng).then(resolve).catch(reject);
        }
      });
    }

    return this._startSpoofer(lat, lng);
  }

  /**
   * Start the ghost_spoofer process with initial coordinates.
   */
  _startSpoofer(lat, lng) {
    // Kill any existing spoof process
    this.stopSpoofing();

    return new Promise((resolve, reject) => {
      const spoofer = this._getSpooferCmd();

      if (!spoofer) {
        // Fallback: use pymobiledevice3 directly (old method, no persistent channel)
        return this._setLocationFallback(lat, lng).then(resolve).catch(reject);
      }

      const args = [
        ...spoofer.args,
        '--rsd-host', this.rsdHost,
        '--rsd-port', String(this.rsdPort),
        '--lat', String(lat),
        '--lng', String(lng)
      ];

      console.log('[Ghost Mode] Starting spoofer:', spoofer.cmd, args.join(' '));

      this.spoofProcess = spawn(spoofer.cmd, args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONWARNINGS: 'ignore' }
      });

      let resolved = false;
      let stderr = '';

      const doResolve = () => {
        if (!resolved) {
          resolved = true;
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
        const msg = data.toString().trim();
        console.log('[Ghost Mode] Spoofer:', msg);
        if (msg === 'READY' || msg.startsWith('OK set')) {
          doResolve();
        }
      });

      this.spoofProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        console.log('[Ghost Mode] Spoofer stderr:', msg.trim());
        // Only collect real errors, ignore Python warnings
        if (!msg.includes('Warning:') && !msg.includes('warnings.warn')) {
          stderr += msg;
        }
      });

      this.spoofProcess.on('close', (code) => {
        this.spoofProcess = null;
        if (!resolved) {
          if (code === 0) {
            doResolve();
          } else {
            const errMsg = stderr.trim() || `Spoofer exited (code ${code})`;
            doReject(errMsg);
          }
        }
      });

      this.spoofProcess.on('error', (err) => {
        doReject(`Failed to start spoofer: ${err.message}`);
      });

      setTimeout(() => {
        doReject('Spoofer timed out (60s).');
      }, 60000);
    });
  }

  /**
   * Fallback: use pymobiledevice3 directly (old method) if ghost_spoofer not available.
   */
  _setLocationFallback(lat, lng) {
    return new Promise((resolve, reject) => {
      const args = [
        'developer', 'dvt', 'simulate-location', 'set',
        '--rsd', this.rsdHost, this.rsdPort,
        '--', String(lat), String(lng)
      ];

      this.spoofProcess = spawn(getPmd3Path(), args, { shell: false });

      let stdout = '';
      let resolved = false;

      this.spoofProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.includes('Press ENTER') || stdout.includes('press enter')) {
          if (!resolved) { resolved = true; resolve({ success: true }); }
        }
      });

      this.spoofProcess.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          if (code === 0) resolve({ success: true });
          else reject(new Error(`Command failed (code ${code})`));
        }
      });

      this.spoofProcess.on('error', (err) => {
        if (!resolved) { resolved = true; reject(new Error(err.message)); }
      });

      setTimeout(() => {
        if (!resolved) { resolved = true; reject(new Error('Timed out')); }
      }, 60000);
    });
  }

  /**
   * Travel to location gradually (realistic movement).
   * Requires spoofer to already be running.
   */
  travelTo(lat, lng) {
    if (!this.hasRsd()) {
      return Promise.reject(new Error('No RSD connection.'));
    }

    this.currentLat = lat;
    this.currentLng = lng;

    // If spoofer already running, send travel command
    if (this.spoofProcess && !this.spoofProcess.killed) {
      return new Promise((resolve, reject) => {
        try {
          this.spoofProcess.stdin.write(`travel ${lat} ${lng}\n`);

          const onData = (data) => {
            const lines = data.toString().trim().split('\n');
            for (const msg of lines) {
              if (msg.startsWith('OK travel')) {
                this.spoofProcess.stdout.removeListener('data', onData);
                resolve({ success: true, arrived: true });
                return;
              }
              if (msg.startsWith('TRAVELING')) {
                const parts = msg.split(' ');
                const progress = parseInt(parts[3]) || 0;
                // Send progress event back (will be picked up by renderer)
                if (this._onTravelProgress) {
                  this._onTravelProgress(parseFloat(parts[1]), parseFloat(parts[2]), progress);
                }
              }
              if (msg.startsWith('ERROR')) {
                this.spoofProcess.stdout.removeListener('data', onData);
                reject(new Error(msg));
                return;
              }
            }
          };
          this.spoofProcess.stdout.on('data', onData);

          // Travel can take up to 10+ minutes
          setTimeout(() => {
            this.spoofProcess.stdout.removeListener('data', onData);
            resolve({ success: true, arrived: true });
          }, 660000);
        } catch (e) {
          reject(new Error(`Travel failed: ${e.message}`));
        }
      });
    }

    // If no spoofer running, start one then travel
    return this._startSpoofer(lat, lng);
  }

  /**
   * Stop spoofing — send clear + quit to spoofer, then kill.
   */
  stopSpoofing() {
    if (this.spoofProcess) {
      try { this.spoofProcess.stdin.write('clear\n'); } catch (e) {}
      try { this.spoofProcess.stdin.write('quit\n'); } catch (e) {}
      setTimeout(() => {
        try { this.spoofProcess.kill(); } catch (e) {}
        this.spoofProcess = null;
      }, 1000);
    }
  }

  /**
   * Clear simulated location and stop everything.
   */
  clearLocation() {
    if (!this.hasRsd()) {
      return Promise.reject(new Error('No RSD connection.'));
    }

    // If spoofer is running, send clear command through it
    if (this.spoofProcess && !this.spoofProcess.killed) {
      return new Promise((resolve) => {
        try {
          this.spoofProcess.stdin.write('clear\n');
          this.spoofProcess.stdin.write('quit\n');
        } catch (e) {}
        setTimeout(() => {
          try { this.spoofProcess.kill(); } catch (e) {}
          this.spoofProcess = null;
          this.currentLat = null;
          this.currentLng = null;
          resolve({ success: true });
        }, 1000);
      });
    }

    // Fallback: spawn clear command directly
    this.stopSpoofing();
    return new Promise((resolve, reject) => {
      const args = [
        'developer', 'dvt', 'simulate-location', 'clear',
        '--rsd', this.rsdHost, this.rsdPort
      ];

      const proc = spawn(getPmd3Path(), args, { shell: false });
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
      const pmd3 = getPmd3Path();
      console.log('[Ghost Mode] checkStatus using:', pmd3);

      // Use exec with quoted path (works reliably with spaces in path)

      execFile(pmd3, ["usbmux","list"], { timeout: 10000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          console.log('[Ghost Mode] checkStatus error:', error.message);

          // If bundled exe failed, try system pymobiledevice3 as fallback
          if (pmd3 !== 'pymobiledevice3') {
            console.log('[Ghost Mode] Trying system pymobiledevice3 fallback...');
            execFile('pymobiledevice3', ['usbmux', 'list'], { timeout: 10000, windowsHide: true }, (err2, stdout2) => {
              if (err2) {
                resolve({ installed: false, connected: false, error: err2.message });
                return;
              }
              const hasDevice = stdout2.includes('UniqueDeviceID') || stdout2.includes('DeviceName');
              resolve({ installed: true, connected: hasDevice, output: stdout2.trim() });
            });
            return;
          }

          resolve({ installed: false, connected: false, error: error.message });
          return;
        }
        const hasDevice = stdout.includes('UniqueDeviceID') || stdout.includes('DeviceName');
        resolve({ installed: true, connected: hasDevice, output: stdout.trim() });
      });
    });
  }

  /**
   * Check if Apple Mobile Device drivers (iTunes) are installed.
   * Checks: traditional service, Microsoft Store iTunes, or direct device access.
   */
  checkiTunes() {
    if (process.platform === 'darwin') return Promise.resolve({ installed: true, builtIn: true });
    return new Promise((resolve) => {
      // Check 1: Traditional iTunes service
      exec('sc query AppleMobileDeviceService', { timeout: 5000 }, (err1) => {
        if (!err1) { resolve({ installed: true }); return; }

        // Check 2: Microsoft Store iTunes (on PATH)
        exec('where iTunes', { timeout: 5000 }, (err2) => {
          if (!err2) { resolve({ installed: true }); return; }

          // Check 3: Can we talk to a device at all? (drivers work even without iTunes found)
          const pmd3 = getPmd3Path();

          execFile(pmd3, ["usbmux","list"], { timeout: 10000, windowsHide: true }, (err3) => {
            if (!err3) { resolve({ installed: true }); return; }
            resolve({ installed: false });
          });
        });
      });
    });
  }

  /**
   * Check if Developer Mode is enabled on the connected iOS device.
   */
  checkDevMode() {
    return new Promise((resolve) => {
      const pmd3 = getPmd3Path();

      execFile(pmd3, ["amfi","developer-mode-status"], { timeout: 15000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          // If bundled exe failed, try system pymobiledevice3 as fallback
          if (pmd3 !== 'pymobiledevice3') {
            console.log('[Ghost Mode] checkDevMode: Trying system pymobiledevice3 fallback...');
            execFile('pymobiledevice3', ['amfi', 'developer-mode-status'], { timeout: 15000, windowsHide: true }, (err2, stdout2, stderr2) => {
              if (err2) {
                resolve({ enabled: false });
                return;
              }
              const output = (stdout2 + ' ' + (stderr2 || '')).toLowerCase();
              const isEnabled = output.includes('true') || output.includes('enabled');
              resolve({ enabled: isEnabled });
            });
            return;
          }
          resolve({ enabled: false });
          return;
        }
        const output = (stdout + ' ' + (stderr || '')).toLowerCase();
        const isEnabled = output.includes('true') || output.includes('enabled');
        resolve({ enabled: isEnabled });
      });
    });
  }

  /**
   * Enable Developer Mode on the connected iOS device.
   */
  enableDevMode() {
    return new Promise((resolve) => {
      const pmd3 = getPmd3Path();

      execFile(pmd3, ["amfi","enable-developer-mode"], { timeout: 30000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          resolve({ error: error.message });
          return;
        }
        resolve({ success: true });
      });
    });
  }

  destroy() {
    this.stopSpoofing();
    this.stopTunnel();
  }
}

module.exports = DeviceBridge;
