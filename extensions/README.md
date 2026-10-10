# Local tool extensions

Copy a plugin folder here and restart FrameLine. Each folder needs `plugin.json` and its declared entry points. See [the developer guide](../docs/plugin-development.md) and [Invert Colors example](../docs/examples/invert-colors).

FrameLine also loads tools from the `extensions` folder in its user-data directory. Extensions are trusted local code and run with the app's privileges; install code you trust.
