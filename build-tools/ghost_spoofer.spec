# -*- mode: python ; coding: utf-8 -*-
import sys
from PyInstaller.utils.hooks import collect_all, copy_metadata

datas = []
binaries = []
hiddenimports = []
for pkg in ['pymobiledevice3', 'pytun_pmd3']:
    tmp_ret = collect_all(pkg)
    datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
for pkg in ['pymobiledevice3', 'pyimg4', 'pytun-pmd3']:
    try:
        datas += copy_metadata(pkg, recursive=True)
    except Exception:
        pass
# sslpsk_pmd3 bundles an older libcrypto on macOS. Leaving it beside
# cryptography's Rust extension causes dyld to resolve the wrong OpenSSL ABI.
# The Mac app uses pymobiledevice3's native remote tunnel, so omit that
# classic-tunnel dylib; Windows retains its normal bundled dependencies.
if sys.platform == 'darwin':
    def _is_sslpsk_dylib(entry):
        return 'sslpsk_pmd3' in str(entry[0]).replace('\\\\', '/') and '.dylib' in str(entry[0])
    binaries = [entry for entry in binaries if not _is_sslpsk_dylib(entry)]
    datas = [entry for entry in datas if not _is_sslpsk_dylib(entry)]
if sys.platform == 'darwin':
    for pkg in ['apple_compress', 'opack', 'srptools']:
        try:
            tmp_ret = collect_all(pkg)
            datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
        except Exception:
            hiddenimports.append(pkg)


a = Analysis(
    ['ghost_spoofer.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['torch', 'tensorflow', 'numpy', 'pandas'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ghost_spoofer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
