# Windows and macOS builds

macOS apps use .app bundles, .dmg installers, or .zip archives; a Windows .exe does not run natively on a Mac.

## Native Mac build

Use an Apple Silicon Mac for arm64 and an Intel Mac for x64. Build the Python helpers on that same machine. PyInstaller is not a cross-compiler.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r build-tools/requirements-build.txt
python build-tools/build_helpers.py
npm ci
npm test
npm run dist:mac
```

Output:
- release/Ghost-Mode-macOS-arm64.dmg and .zip on Apple Silicon
- release/Ghost-Mode-macOS-x64.dmg and .zip on Intel

The app bundles Python and its dependencies. End users do not need Python or iTunes on macOS. The Mac wizard skips Apple drivers and starts the native remote tunnel without elevation. The pinned pymobiledevice3 version provides this no-root native transport. GPS behavior still needs physical-device verification on each supported iOS/macOS combination.

## Windows build

Run the same helper build using Python on Windows, then `npm run dist:win`. Existing Windows helpers in resources can also be reused. Outputs are Ghost-Mode-Windows-x64.exe (portable) and Ghost-Mode-Windows-Setup-x64.exe.

## Automated releases

.github/workflows/build.yml runs native builds on Windows, Apple Silicon, and Intel macOS. A manual workflow dispatch saves build artifacts. Pushing a v-prefixed tag builds all platforms and publishes a GitHub Release only after every build passes.

Before uploading this project, review the files to commit; build output, virtual environments, resources, and website download binaries are ignored. The native helpers are recreated in CI.

Set the repository in the website's download manifest and use these stable asset URLs:
`https://github.com/OWNER/REPO/releases/latest/download/Ghost-Mode-Windows-x64.exe`
`https://github.com/OWNER/REPO/releases/latest/download/Ghost-Mode-macOS-arm64.dmg`
`https://github.com/OWNER/REPO/releases/latest/download/Ghost-Mode-macOS-x64.dmg`

Only mark an asset available in downloads-config.js after its URL exists. The site does not present missing builds as completed downloads.

## Signing

For trusted public Mac distribution, supply CSC_LINK and CSC_KEY_PASSWORD for a Developer ID Application certificate and APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID for notarization in GitHub repository secrets. Do not commit credentials. Without these, the build is unsigned/ad-hoc signed and is not notarized; macOS may block opening a downloaded build. The workflow builds unsigned artifacts by default so empty signing secrets cannot be misread as filesystem paths. To sign and notarize, add a dedicated signing step with non-empty certificate and Apple credentials after the unsigned build is working.

## Validation

`npm test` exercises both platform branches using simulated child processes and verifies platform-specific packaging. CI smoke-tests the native helper executables with --help. These checks do not replace testing an actual iPhone connection, Developer Mode, travel, jitter, and reset on a Mac.


After publishing all three release files, run:

```sh
node build-tools/configure-downloads.cjs OWNER/REPO
```

This verifies every download URL before enabling it and updates website repository links. Deploy index.html, styles.css, script.js, downloads-config.js, downloads.js, ghost-logo.jpeg and assets/. For local testing, the Windows executable is served from website/downloads/.

