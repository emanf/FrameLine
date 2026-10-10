# Building FrameLine

`scripts/build.py` packages Electron, the Python image engine, Pillow, Sharp, FFmpeg, and FFprobe. Release users do not need to install Python or Node.js. The default output is a portable archive; add `--installer` to also create an installer.

## Native build

Use Python 3.12 or newer and Node.js 20.9 or newer, with the same architecture as the target. Each operating system must build its own packages because the Python engine and native image libraries cannot be cross-compiled by this script.

From the repository root:

```sh
python -m pip install -r requirements-build.txt
python scripts/build.py
```

The script installs locked production npm dependencies in temporary staging, freezes the Python engine with PyInstaller, verifies worker IPC, plugin processing and GIF export, then runs a pinned Electron Builder. A final check uses the packaged Electron executable to verify native SVG/AVIF decoding, fonts, media binaries, plugin processing and GIF export. It leaves the development installation untouched. Internet access is needed to download build dependencies and Electron.

Examples:

```sh
python scripts/build.py --platform windows --arch x64
python scripts/build.py --platform macos --arch arm64
python scripts/build.py --platform linux --arch x64 --installer
python scripts/build.py --output dist
python scripts/build.py --all --legacy-windows-x86 --dry-run
```

`--all` lists the matrix and builds the target matching the current interpreter. Other targets are clearly marked as requiring a matching runner. It does not claim to compile every platform from one computer.

## Platform support

| Platform | Architecture | Output | Notes |
| --- | --- | --- | --- |
| Windows | x64 | ZIP; optional NSIS installer | Current Electron from the lockfile |
| Windows | x86 | ZIP; optional NSIS installer | Explicit legacy mode; experimental until tested on a 32-bit system |
| macOS | x64, ARM64 | ZIP containing `.app`; optional DMG | Separate native builds |
| Linux | x64, ARM64 | tar.gz; optional AppImage | Native glibc build; distribution compatibility follows the build host |

Linux and macOS x86 are unavailable in modern Electron. Windows ARM64 is excluded because the current media dependencies do not provide a complete matching binary set.

### Legacy Windows x86

Electron 44 removed Windows x86 binaries. This mode explicitly selects Electron 43.0.0 and an older FFmpeg 4.4.1 x86 binary without changing the project's development dependencies. Use **32-bit Python 3.12** and **32-bit Node.js 20**; Sharp's x86 support requires Node 20 for the build environment.

```sh
python -m pip install -r requirements-build.txt
python scripts/build.py --platform windows --arch x86 --legacy-windows-x86
```

The script rejects a 64-bit interpreter or mismatched Node installation. Use `--node` to select a particular Node executable. Legacy builds need separate testing on the intended Windows version; this is not Windows 7/8 support. Update the pinned legacy Electron release when maintaining this target.

### Media overrides

The npm FFprobe package lacks Linux ARM64. The script downloads a pinned ARM64 FFprobe from the FFmpeg Static release and verifies its SHA-256. Default modern FFmpeg binaries are also verified against pinned SHA-256 values, including when reusing a matching local binary. Windows x86 also uses a pinned upstream fallback for FFmpeg. To supply your own native binaries:

```sh
python scripts/build.py --ffmpeg /path/to/ffmpeg --ffprobe /path/to/ffprobe
```

Overrides must match the target architecture. Both binaries are executed before packaging to check they start. Use standalone binaries whose library dependencies are available on the destination system.

## Output folders

Every run gets a unique folder, so older releases stay available:

```text
build/releases/
  windows/x64/<timestamp>/
  windows/x86/<timestamp>/
  macos/x64/<timestamp>/
  macos/arm64/<timestamp>/
  linux/x64/<timestamp>/
  linux/arm64/<timestamp>/
```

Each contains the archive, unpacked application, `build.log`, and `build-manifest.json` with versions, build status, artifact sizes, and SHA-256 checksums. Temporary staging is removed after completion. Build output is excluded by `.gitignore`.

## Build and upload on GitHub

The repository contains one GitHub Actions workflow: **Build and upload to latest release**. It runs only when started manually by the repository owner. It also checks who re-runs a job, so a collaborator cannot re-run an owner's release build.

1. Push the workflow and build scripts to the default branch.
2. Create and publish a stable release whose tag includes the build scripts, `requirements-build.txt`, and application source.
3. Open **Actions → Build and upload to latest release → Run workflow**.
4. Keep Windows x86 enabled to build all six targets. It uses the experimental legacy runtime described above. Optionally enable installers.
5. Wait for the builds and upload job. Packages appear under the existing release's Assets, together with `SHA256SUMS.txt` and `FrameLine-builds.json`.

The workflow selects GitHub's latest published stable release when it starts and builds the exact commit referenced by that release's tag. Drafts and prereleases are excluded. If another release appears during the build, uploads still go to the originally selected release. A missing release, immutable release, or moved tag stops the workflow with a clear error.

Every selected platform must build successfully before publishing starts. Archives are checked against their build manifests before upload. Failed builds retain diagnostic workflow artifacts; they do not start the upload job.

If generated assets are already attached, enable **Replace matching generated assets** to rebuild them. Only matching package/checksum/manifest filenames are replaced; other release assets, its title, notes, and tag stay intact. Without this option, filename collisions stop publication before any asset is changed. GitHub uploads occur file by file, so a network/API failure during upload can leave a partial set; re-run with replacement enabled to finish.

No personal access token is needed. Build jobs receive read-only repository access, and only the upload job receives `contents: write` through `GITHUB_TOKEN`. Runs are serialized to avoid two release uploads racing each other.

On a personal fork, the owner check follows the fork's repository owner, and uploads target that fork's releases. The fork owner must enable Actions and create a release first. This owner policy is intended for personal repositories; an organization owner name is not an individual login. Anyone with permission to edit workflows or administer the repository can change the policy, so keep those permissions limited to people you trust.

## Distribution and extensions

The app icon source and platform formats live in `src/assets/icons`. Regenerate ICO, ICNS, and Linux PNG files with `node scripts/generate-icons.mjs` after updating the source PNG. Builds embed these icons in platform packages and copy the native window icons to `resources/icons`.

Builds are unsigned by default. Signing and notarization require a separate setup; the manual workflow handles uploading unsigned packages. The optional Linux AppImage requires the system packaging tools used by Electron Builder.

The image engine and media binaries live outside `app.asar`; Sharp's native libraries are unpacked. Extensions included in the checkout are copied to `resources/extensions`, outside the archive, so Python can load their processors. Additional tools can be installed in the user-data `extensions` directory. Python processors can use the bundled Pillow and standard library; plugins requiring additional Python packages need those dependencies included in a custom build.

Test the exported app on each target before publishing, including SVG/AVIF import, video import/export, projects, and third-party tools. Builds on a newer Linux distribution may require a newer glibc than older distributions provide.

References: [Electron platform changes](https://www.electronjs.org/blog/electron-44-0), [PyInstaller platform requirements](https://pyinstaller.org/en/stable/requirements.html), [Sharp installation](https://sharp.pixelplumbing.com/install/).
