import { EditorApplication } from './application/editor-application.mjs';

// The entry point owns composition; models and views live in focused modules.
new EditorApplication().start();
