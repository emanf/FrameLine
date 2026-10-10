# Contributing to FrameLine

Install Node.js 20+, Python 3.10+, and the repository dependencies described in the README. Run `npm start` from the checkout. The [architecture guide](architecture.md) describes ownership and data flow; the [plugin guide](plugin-development.md) covers tools that can be added without modifying the app.

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
npm run test:main
```

The JavaScript suite covers project rules, brushes, selection, history, storage, discovery, and option schemas. The Python suite covers image algorithms, rendering, archives, exports, cancellation, and plugin processing. The Electron UI suite checks real controls and workflows with deterministic fixture services. The production suite uses real IPC, preload, Python workers, imports, and a temporarily installed example plugin.

When changing processing, verify preview and Apply equality, alpha handling, current edited inputs, undo, cancellation, and portable persistence. When changing project fields or frame behavior, update validation and relevant model tests. Keep tests in version control; only generated caches, coverage, and build artifacts belong in `.gitignore`.

`python scripts/benchmark-effects.py` measures effect timings and output hashes on fixed fixtures. Compare the same input, dimensions, settings, and environment when making performance claims. Avoid replacing a native Pillow operation with per-pixel Python loops without measurement.

## Documentation

Keep user-facing features in the README concise and listed once. Put implementation details in these developer guides. Update the API reference if a tool contract changes, and preserve a working example. Applied plugin images should remain usable after a plugin is removed; backward compatibility includes opening existing `.frameline` and legacy JSON projects.
