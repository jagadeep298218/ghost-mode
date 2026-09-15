# Ghost Mode

Free, open-source iOS GPS location spoofer. Set your iPhone's location to anywhere in the world — no jailbreak required.

## How It Works

Ghost Mode uses Apple's developer debug channel (`com.apple.dt.simulatelocation`) to override your iPhone's GPS. It communicates with your device over USB using [pymobiledevice3](https://github.com/doronz88/pymobiledevice3). Once set, the spoofed location persists even after unplugging — until you reboot or toggle Location Services.

## Prerequisites

1. **Python 3.8+** — [Download](https://www.python.org/downloads/)
2. **iTunes** — [Download](https://www.apple.com/itunes/) (provides the USB driver on Windows)
3. **pymobiledevice3** — Install via pip:
   ```bash
   pip install pymobiledevice3
   ```
4. **Developer Mode** on your iPhone (iOS 16+):
   - Go to Settings > Privacy & Security > Developer Mode > Enable
   - Restart your phone when prompted

## Install

Download the latest release from [GitHub Releases](https://github.com/AnonAmit/ghost-mode/releases), or build from source:

```bash
git clone https://github.com/AnonAmit/ghost-mode.git
cd ghost-mode
npm install
npm start
```

## Usage

1. Connect your iPhone via USB cable
2. Trust the computer on your iPhone if prompted
3. Launch Ghost Mode (**run as Administrator** — required for the iOS tunnel)
4. Search for an address or click the map to pick a location
5. Click **Spoof Location**
6. Unplug your phone and go — your location stays spoofed
7. To restore real GPS: reboot your phone or toggle Location Services off/on

## Features

- Click or search to set any location worldwide
- Drag the marker to fine-tune position
- Save your home location for one-click spoofing
- Dark theme UI
- No account, no subscription, no ads — completely free

## Supported

- **iOS:** 17+ (tested), 16 (should work), 15 and below (use older pymobiledevice3)
- **OS:** Windows 10/11 (primary), macOS and Linux (should work)

## Building a Release

```bash
npm run dist
```

Produces a portable .exe in the `dist/` folder.

## Troubleshooting

- **"pymobiledevice3 not found"** — Make sure Python and pymobiledevice3 are installed and in your PATH
- **"No iOS device detected"** — Install iTunes, connect via USB, tap "Trust" on your phone
- **"Tunnel failed"** — You must run Ghost Mode as Administrator (right-click > Run as administrator)
- **"Developer Mode required"** — Enable Developer Mode in iPhone Settings > Privacy & Security

## License

MIT
