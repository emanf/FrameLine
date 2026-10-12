# Contributing to FrameLine

Install Node.js 20+, Python 3.12+, and the repository dependencies described in the README. Run `npm start` from the checkout. The [architecture guide](architecture.md) describes ownership and data flow; the [plugin guide](plugin-development.md) covers tools that can be added without modifying the app.

## Where to make a change

| Change | Location |
| --- | --- |
| Project rules, whole-frame math, validation | `src/renderer/model/` |
| Persistent editing commands | `src/renderer/viewmodel/commands/` |
| History and selection state | `src/renderer/viewmodel/timeline-view-model.mjs` |
| Transient gesture/preview state | `src/renderer/viewmodel/editor-session-view-model.mjs` |
| DOM/canvas presentation | `src/renderer/view/` |
| UI workflow and input routing | `src/renderer/application/controllers/` |
| Tool metadata and adapters | `src/renderer/tools/builtin/` |
| Desktop services and IPC | `src/main/`, `src/preload.cjs` |
| Python command groups | `backend/commands/` |
| Image algorithms | Focused modules in `backend/` |
| Third-party tools | `extensions/<tool-folder>/` |

Keep Node and Electron APIs behind main-process handlers and the preload bridge. Keep timeline units as whole frames. Do not put DOM access in models or editing command classes. New asynchronous image work should use revision guards, release stale owned outputs, and provide progress.

Add a class or function comment that explains responsibility, inputs, returned state, and ownership where useful. Describe behavior rather than change history. Prefer a focused module and a named service over adding another unrelated branch to an existing controller.

## Tests

```sh
npm test
npm run test:backend
npm run test:ui
npm run test:timeline
npm run test:main
```

The JavaScript suite covers project rules, brushes, selection, history, storage, discovery, and option schemas. The Python suite covers image algorithms, rendering, archives, exports, cancellation, and plugin processing. The Electron UI suite checks real controls and workflows with deterministic fixture services. The production suite uses real IPC, preload, Python workers, imports, and a temporarily installed example plugin.

The focused timeline UI suite checks cleanup patterns, paged worker previews, edited thumbnails, cancellation, Apply/Undo/Redo, selected Reverse, playback controls, and the Add dialog. It also exercises uninterrupted Brush, Ignore, and Recover strokes on a 1280×960 image, checking stable frame timings and identical held, released, applied, and history pixels.

The same suite checks toolbox sections, Clear/Recover placement, the view-only Ignore toggle, About metadata, and contact copying. Version assertions read `package.json` so a release bump does not require changing fixture versions elsewhere. Mask tests cover sparse allocation, appended-segment work, protection, and parity with complete rendering.

When changing processing, verify preview and Apply equality, alpha handling, current edited inputs, undo, cancellation, and portable persistence. When changing project fields or frame behavior, update validation and relevant model tests. Keep tests in version control; only generated caches, coverage, and build artifacts belong in `.gitignore`.

`python scripts/benchmark-effects.py` measures effect timings and output hashes on fixed fixtures. `node scripts/benchmark-brush.mjs` compares complete-path and cached coverage updates for 2,400-point strokes, with and without feather. Compare the same input, dimensions, settings, and environment when making performance claims. Avoid replacing a native Pillow operation with per-pixel Python loops without measurement.

## Documentation

Keep user-facing features in the README concise and listed once. Put implementation details in these developer guides. Update the API reference if a tool contract changes, and preserve a working example. Applied plugin images should remain usable after a plugin is removed; backward compatibility includes opening existing `.frameline` and legacy JSON projects.

The [user guide](user-guide.md) explains editing steps and control behavior; [CHANGELOG.md](../CHANGELOG.md) records release-specific additions and fixes. Keep screenshot descriptions accurate and avoid replacing an existing screenshot with a placeholder.

## Preparing a release

1. Update the application version with `npm version <version> --no-git-tag-version --ignore-scripts`. This updates the package and lockfile without creating a commit or tag. Change project format or plugin API versions only when their contracts require it.
2. Update the README version, changelog entry, relevant guides, and `src/shared/app-info.json` update date.
3. Run the five test commands above, check `git diff --check`, and review both modified and new files with `git status --short`. Source files, tests, docs, release metadata, and the lockfile belong in the commit; generated build output stays ignored.
4. Commit and push the reviewed changes, then publish a stable GitHub release whose tag points to that commit.
5. Manually run the owner-only build workflow described in [Building](building.md#build-and-upload-on-github). It attaches verified packages to that published release.

Dependency lockfiles, project bundles, and compiled packages have different purposes. Commit `package-lock.json` with dependency or version changes; `.frameline` files are user projects; distribution packages belong on GitHub Releases.
