// Mac links are enabled by build-tools/configure-downloads.cjs after a native
// macOS build has been published and its release URLs have been verified.
window.GHOST_DOWNLOADS = {
  windows: { url: "downloads/Ghost-Mode-Windows-x64.exe", available: true },
  macArm64: { url: null, available: false },
  macX64: { url: null, available: false }
};
