"""Build standalone FrameLine releases with native Python and Electron runtimes.

Run on the target OS with Node and Python matching the requested architecture.
Use --dry-run to inspect the build matrix without downloading dependencies.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import gzip
import json
import os
from pathlib import Path
import platform
import shutil
import struct
import subprocess
import sys
import tempfile
import uuid
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BUILDER_VERSION = "26.0.12"
LEGACY_ELECTRON = "43.0.0"
FFMPEG_HASHES = {
    "windows/x64": "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00",
    "macos/x64": "ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894",
    "macos/arm64": "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584",
    "linux/x64": "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99",
    "linux/arm64": "6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce",
}


@dataclass(frozen=True)
class Target:
    """A supported OS/CPU pair; folder names use x86 rather than Node's ia32."""
    system: str
    arch: str

    @property
    def node_arch(self):
        return "ia32" if self.arch == "x86" else self.arch

    @property
    def node_platform(self):
        return {"windows": "win32", "macos": "darwin", "linux": "linux"}[self.system]

    @property
    def name(self):
        return f"{self.system}/{self.arch}"


TARGETS = (Target("windows", "x64"), Target("windows", "x86"),
           Target("macos", "x64"), Target("macos", "arm64"),
           Target("linux", "x64"), Target("linux", "arm64"))


def host_target():
    """Identify the running interpreter, including 32-bit Python on 64-bit Windows."""
    system = {"win32": "windows", "darwin": "macos", "linux": "linux"}.get(sys.platform)
    if not system:
        raise ValueError(f"Unsupported build host: {sys.platform}")
    arch = "x86" if struct.calcsize("P") == 4 else (
        "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64")
    return Target(system, arch)


def select_targets(system, arch, host, legacy=False):
    """Expand a requested matrix without pretending unsupported x86 targets exist."""
    system = host.system if system == "auto" else system
    arch = host.arch if arch == "auto" else arch
    result = [target for target in TARGETS if system in ("all", target.system)
              and arch in ("all", target.arch)]
    if not result:
        raise ValueError(f"Unsupported target {system}/{arch}. x86 is Windows-only.")
    if not legacy:
        if arch == "x86":
            raise ValueError("Windows x86 requires --legacy-windows-x86 (Electron 43).")
        result = [target for target in result if target.arch != "x86"]
    return result


def npm_command(node):
    """Run npm's JS entry point directly so Windows paths never pass through cmd.exe."""
    shim = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not shim:
        raise ValueError("npm was not found. Install Node.js with npm and add it to PATH.")
    resolved = Path(shim).resolve()
    candidates = [resolved.parent / "node_modules/npm/bin/npm-cli.js",
                  resolved.parent / "npm-cli.js"]
    for candidate in candidates:
        if candidate.is_file():
            return [node, str(candidate)]
    raise ValueError(f"Cannot locate npm-cli.js beside {shim}. Use an official Node installation.")


def download_binary(asset, destination, checksum=None):
    """Download a pinned upstream media binary where npm has no matching artifact."""
    url = "https://github.com/eugeneware/ffmpeg-static/releases/download/" + asset
    print(f"Downloading native media: {url}", flush=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with urllib.request.urlopen(url + ".gz", timeout=120) as response, gzip.GzipFile(fileobj=response) as binary, destination.open("wb") as output:
        while chunk := binary.read(1024 * 1024):
            digest.update(chunk)
            output.write(chunk)
    if checksum and digest.hexdigest() != checksum:
        destination.unlink()
        raise ValueError(f"Checksum mismatch for {asset}")


def copy_media_license(target, media, override):
    """Retain the license distributed with the selected FFmpeg build."""
    if override:
        companion = Path(str(override) + ".LICENSE")
        if companion.is_file():
            shutil.copy2(companion, media / "ffmpeg.LICENSE")
        return
    suffix = '.exe' if target.system == 'windows' else ''
    cached_binary = ROOT / 'node_modules/ffmpeg-static' / f'ffmpeg{suffix}'
    cached_license = Path(str(cached_binary) + '.LICENSE')
    checksum = FFMPEG_HASHES.get(target.name)
    if checksum and cached_binary.is_file() and cached_license.is_file() and hashlib.sha256(cached_binary.read_bytes()).hexdigest() == checksum:
        shutil.copy2(cached_license, media / 'ffmpeg.LICENSE')
        return
    release = "b4.4.1" if target.arch == "x86" else "b6.1.1"
    url = ("https://github.com/eugeneware/ffmpeg-static/releases/download/"
           f"{release}/{target.node_platform}-{target.node_arch}.LICENSE")
    with urllib.request.urlopen(url, timeout=60) as response:
        (media / "ffmpeg.LICENSE").write_bytes(response.read())


def run(command, cwd, log, env=None):
    """Stream subprocess progress to the terminal and retain a complete build log."""
    print("\n> " + subprocess.list2cmdline([str(value) for value in command]), flush=True)
    with log.open("a", encoding="utf-8") as output:
        output.write("\n> " + repr(command) + "\n")
        with subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                              errors="replace") as child:
            try:
                for line in child.stdout:
                    print(line, end="", flush=True)
                    output.write(line)
                    output.flush()
                code = child.wait()
            except BaseException:
                child.terminate()
                child.wait()
                raise
        if code:
            raise RuntimeError(f"Build command exited with {code}; see {log}")


def builder_config(target, backend, media, output, electron_version, installer=False):
    """Package native resources externally and leave Sharp libraries unpacked."""
    formats = {"windows": ["zip"], "macos": ["zip"], "linux": ["tar.gz"]}[target.system]
    if installer:
        formats.append({"windows": "nsis", "macos": "dmg", "linux": "AppImage"}[target.system])
    config = {
        "appId": "com.emanf.frameline", "productName": "FrameLine",
        "electronVersion": electron_version, "npmRebuild": False,
        "afterPack": str(ROOT / "scripts/windows-icon.cjs"),
        "directories": {"output": str(output)},
        "artifactName": "FrameLine-${version}-" + target.system + "-" + target.arch + ".${ext}",
        "files": ["src/**/*", "package.json", "node_modules/**/*",
                  "!node_modules/ffprobe-static/bin/**/*", "!node_modules/ffmpeg-static/ffmpeg*"],
        "asar": True, "asarUnpack": ["node_modules/@img/**/*", "node_modules/sharp/**/*"],
        "extraResources": [{"from": str(backend), "to": "backend"},
                           {"from": str(media), "to": "media"},
                           {"from": "extensions", "to": "extensions"},
                           {"from": "src/assets/icons", "to": "icons"}],
        "win": {"target": formats if target.system == "windows" else ["zip"],
                "icon": "src/assets/icons/frameline.ico", "signAndEditExecutable": False},
        "mac": {"target": formats if target.system == "macos" else ["zip"], "category": "public.app-category.graphics-design",
                "identity": None, "icon": "src/assets/icons/frameline.icns"},
        "linux": {"target": formats if target.system == "linux" else ["tar.gz"],
                  "category": "Graphics", "icon": "src/assets/icons/frameline-512.png"},
        "nsis": {"oneClick": False, "allowToChangeInstallationDirectory": True},
        "publish": None,
    }
    return config


def verify_tools(node, target):
    """Reject architecture mismatches before downloading or freezing anything."""
    actual = json.loads(subprocess.check_output([node, "-p",
        "JSON.stringify({arch:process.arch,platform:process.platform,version:process.versions.node})"], text=True))
    if actual["arch"] != target.node_arch or actual["platform"] != target.node_platform:
        raise ValueError(f"Node is {actual['platform']}/{actual['arch']}; {target.name} needs matching Node and Python.")
    major = int(actual["version"].split(".")[0])
    if major < 20 or (major == 20 and int(actual["version"].split(".")[1]) < 9):
        raise ValueError("Node.js 20.9 or newer is required.")
    if target.arch == "x86" and major != 20:
        raise ValueError("The legacy x86 build needs Node.js 20 x86 for Sharp's 32-bit binaries.")
    if sys.version_info < (3, 12):
        raise ValueError("Building needs Python 3.12+; the backend uses Python 3.12 syntax.")


def smoke_engine(executable, directory):
    """Exercise frozen worker IPC, dynamically loaded plugins, and the GIF child worker."""
    from PIL import Image
    image = directory / "fixture.png"
    Image.new("RGBA", (8, 8), (20, 30, 40, 200)).save(image)
    requests = [
        {"id": 1, "command": "inspect_images", "paths": [str(image)]},
        {"id": 2, "command": "process_tool_plugin", "path": str(image),
         "processor": str(ROOT / "docs/examples/invert-colors/processor.py"),
         "options": {}, "output": str(directory / "processed.png")},
    ]
    completed = subprocess.run([str(executable)], input="".join(json.dumps(value) + "\n" for value in requests),
                               capture_output=True, text=True, encoding="utf-8", timeout=60)
    responses = [json.loads(line) for line in completed.stdout.splitlines()]
    results = [value for value in responses if "result" in value or "error" in value]
    if completed.returncode or len(results) != 2 or any("error" in value for value in results):
        raise RuntimeError(f"Frozen worker verification failed: {results} {completed.stderr}")
    gif = directory / "fixture.gif"
    task = {"command": "export_gif", "fps": 24, "output": str(gif),
            "clips": [{"path": str(image), "duration_frames": 2}]}
    exported = subprocess.run([str(executable), "--task", str(directory / "cancel")],
                              input=json.dumps(task), capture_output=True, text=True,
                              encoding="utf-8", timeout=60)
    if exported.returncode or not gif.is_file():
        raise RuntimeError(f"Frozen GIF worker verification failed: {exported.stdout} {exported.stderr}")
    with Image.open(gif) as opened:
        if opened.size != (8, 8):
            raise RuntimeError("Frozen GIF worker returned incorrect image dimensions.")



def verify_package(target, output, work, log):
    """Load Sharp and the bundled workers with the release's own Electron binary."""
    if target.system == "windows":
        application = output / "win-unpacked"
        executable = application / "FrameLine.exe"
        resources = application / "resources"
    elif target.system == "macos":
        candidates = list(output.glob("mac*/FrameLine.app/Contents"))
        if len(candidates) != 1:
            raise RuntimeError("Cannot locate the packaged macOS application.")
        application = candidates[0]
        executable = application / "MacOS/FrameLine"
        resources = application / "Resources"
    else:
        candidates = list(output.glob("linux*unpacked"))
        if len(candidates) != 1:
            raise RuntimeError("Cannot locate the packaged Linux application.")
        application = candidates[0]
        executable = application / "frameline"
        resources = application / "resources"
    env = {**os.environ, "ELECTRON_RUN_AS_NODE": "1", "PYTHONUTF8": "1"}
    run([str(executable), str(ROOT / "scripts/electron-package-check.cjs"), str(resources),
         str(work), str(ROOT / "docs/examples/invert-colors/processor.py"), target.node_arch],
        work, log, env)


def build(target, options, node, npm):
    """Stage locked dependencies, freeze the engine, and produce one isolated release."""
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    electron_version = LEGACY_ELECTRON if target.arch == "x86" else lock["packages"]["node_modules/electron"]["version"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:6]
    output = options.output.resolve() / target.system / target.arch / stamp
    output.mkdir(parents=True, exist_ok=False)
    log = output / "build.log"
    manifest = {"target": target.name, "version": package["version"], "electron": electron_version,
                "python": platform.python_version(), "status": "building", "artifacts": []}
    report = output / "build-manifest.json"
    report.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    work_root = ROOT / "build/.work"
    work_root.mkdir(parents=True, exist_ok=True)
    try:
        # A locked staging file must not hide the build's original error on Windows.
        with tempfile.TemporaryDirectory(prefix="frameline-", dir=work_root,
                                         ignore_cleanup_errors=True) as temporary:
            work = Path(temporary).resolve()
            stage = work / "app"
            stage.mkdir()
            for name in ("src", "extensions"):
                shutil.copytree(ROOT / name, stage / name, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            for name in ("package.json", "package-lock.json"):
                shutil.copy2(ROOT / name, stage / name)
            env = {**os.environ, "ELECTRON_SKIP_BINARY_DOWNLOAD": "1", "PYTHONUTF8": "1",
                   "CSC_IDENTITY_AUTO_DISCOVERY": "false"}
            run(npm + ["ci", "--omit=dev", "--include=optional", "--ignore-scripts"], stage, log, env)
            run([node, "-e", "require('sharp'); console.log('Sharp native module OK')"], stage, log, env)
            media = work / "media"
            media.mkdir()
            suffix = ".exe" if target.system == "windows" else ""
            ffmpeg = stage / "node_modules/ffmpeg-static" / f"ffmpeg{suffix}"
            ffprobe = stage / "node_modules/ffprobe-static/bin" / target.node_platform / target.node_arch / f"ffprobe{suffix}"
            if not options.ffmpeg:
                ffmpeg = work / f"ffmpeg{suffix}"
                checksum = FFMPEG_HASHES.get(target.name)
                existing = ROOT / "node_modules/ffmpeg-static" / f"ffmpeg{suffix}"
                if checksum and existing.is_file() and hashlib.sha256(existing.read_bytes()).hexdigest() == checksum:
                    shutil.copy2(existing, ffmpeg)
                else:
                    asset = "b4.4.1/win32-ia32" if target.arch == "x86" else f"b6.1.1/ffmpeg-{target.node_platform}-{target.node_arch}"
                    download_binary(asset, ffmpeg, checksum)
            if target == Target("linux", "arm64") and not options.ffprobe:
                ffprobe = work / "ffprobe-arm64"
                download_binary("b6.1.1/ffprobe-linux-arm64", ffprobe,
                                "d17ae9b4c297d48e2521ba14e417bb0537c6ff77c584cdbcd6bb0d8d0307a2e8")
            for name, source, override in (("ffmpeg", ffmpeg, options.ffmpeg), ("ffprobe", ffprobe, options.ffprobe)):
                source = override.resolve() if override else source
                if not source.is_file():
                    raise ValueError(f"No {name} binary for {target.name}. Supply --{name} /path/to/native/{name}.")
                destination = media / f"{name}{suffix}"
                shutil.copy2(source, destination)
                destination.chmod(destination.stat().st_mode | 0o111)
                run([str(destination), "-version"], work, log, env)
            copy_media_license(target, media, options.ffmpeg)
            run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--console",
                 "--noupx", "--name", "frameline-engine", "--distpath", str(work / "python"),
                 "--workpath", str(work / "pyinstaller"), "--specpath", str(work),
                 "--paths", str(ROOT / "backend"), "--collect-all", "PIL",
                 "--hidden-import", "tool_plugin", str(ROOT / "backend/engine.py")], ROOT, log, env)
            backend = work / "python/frameline-engine"
            smoke_engine(backend / f"frameline-engine{suffix}", work)
            config = work / "electron-builder.json"
            config.write_text(json.dumps(builder_config(target, backend, media, output,
                                                        electron_version, options.installer), indent=2), encoding="utf-8")
            flag = {"windows": "--win", "macos": "--mac", "linux": "--linux"}[target.system]
            run(npm + ["exec", "--yes", f"--package=electron-builder@{BUILDER_VERSION}", "--",
                       "electron-builder", "--config", str(config), flag,
                       f"--{target.node_arch}", "--publish", "never"], stage, log, env)
            verify_package(target, output, work, log)
        for artifact in output.iterdir():
            if artifact.is_file() and artifact.suffix in (".zip", ".gz", ".exe", ".dmg", ".AppImage"):
                digest = hashlib.sha256()
                with artifact.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(chunk)
                manifest["artifacts"].append({"file": artifact.name, "sha256": digest.hexdigest(), "bytes": artifact.stat().st_size})
        if not manifest["artifacts"]:
            raise RuntimeError("Packaging finished without producing a release archive.")
        manifest["status"] = "complete"
        print(f"\nBuild complete: {output}")
    except BaseException as error:
        manifest.update(status="failed", error=str(error))
        raise
    finally:
        report.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def parse_args(argv=None):
    """Expose native builds, an offline plan, and explicit legacy compatibility."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=("auto", "windows", "macos", "linux", "all"), default="auto")
    parser.add_argument("--arch", choices=("auto", "x86", "x64", "arm64", "all"), default="auto")
    parser.add_argument("--all", action="store_true", help="Show all targets and build the matching native target")
    parser.add_argument("--dry-run", action="store_true", help="Print the plan without installing or building")
    parser.add_argument("--legacy-windows-x86", action="store_true", help="Opt in to Electron 43 for Windows x86")
    parser.add_argument("--installer", action="store_true", help="Also produce NSIS, DMG, or AppImage")
    parser.add_argument("--output", type=Path, default=ROOT / "build/releases")
    parser.add_argument("--node", default="node", help="Matching Node executable")
    parser.add_argument("--ffmpeg", type=Path, help="Override the native FFmpeg binary")
    parser.add_argument("--ffprobe", type=Path, help="Override the native FFprobe binary")
    return parser.parse_args(argv)


def main(argv=None):
    """Build only matching native targets; list other runners required by the matrix."""
    options = parse_args(argv)
    host = host_target()
    system, arch = ("all", "all") if options.all else (options.platform, options.arch)
    targets = select_targets(system, arch, host, options.legacy_windows_x86)
    print(f"Build host: {host.name}")
    for target in targets:
        reason = "native build" if target == host else "requires matching OS, Python and Node runner"
        legacy = " (legacy Electron 43)" if target.arch == "x86" else ""
        print(f"  {target.name}{legacy}: {reason}")
    if options.dry_run:
        return 0
    if host not in targets:
        raise ValueError("No requested target matches this Python interpreter. Run on a matching native runner.")
    node = shutil.which(options.node)
    if not node:
        raise ValueError("Node.js was not found.")
    verify_tools(node, host)
    try:
        import PyInstaller  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError as error:
        raise ValueError("Install build requirements: python -m pip install -r requirements-build.txt") from error
    build(host, options, node, npm_command(node))
    return 0


if __name__ == "__main__":
    # Build tools emit Unicode status symbols even when Windows uses a legacy code page.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, subprocess.SubprocessError, OSError) as error:
        print(f"Build failed: {error}", file=sys.stderr)
        raise SystemExit(1)
