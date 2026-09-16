"""Build the device helpers on the OS and CPU that will run them."""
import os
from pathlib import Path
import platform
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent

def main():
    if sys.platform not in ("win32", "darwin"):
        raise SystemExit("Build on Windows or macOS; native helpers cannot be cross-compiled.")
    if sys.platform == "darwin":
        expected = os.environ.get("GHOST_BUILD_ARCH")
        actual = "arm64" if platform.machine() == "arm64" else "x64"
        if expected and expected != actual:
            raise SystemExit(f"Use a native {expected} Mac runner; this Python is {actual}.")
    for name in ("pymobiledevice3", "ghost_spoofer"):
        subprocess.run([
            sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
            "--distpath", str(ROOT / "resources"),
            "--workpath", str(ROOT / "build-tools" / "build"),
            str(ROOT / "build-tools" / f"{name}.spec"),
        ], cwd=ROOT / "build-tools", check=True)
        executable = ROOT / "resources" / (name + (".exe" if sys.platform == "win32" else ""))
        if sys.platform == "darwin":
            executable.chmod(0o755)
        subprocess.run([str(executable), "--help"], check=True, timeout=120)
    print("Native helpers built and smoke-tested.")

if __name__ == "__main__":
    main()

