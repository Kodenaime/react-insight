/**
 * @react-insight/launch-editor
 *
 * Optional companion for IDE "Jump to Code" navigation.
 *
 * This package provides a lightweight dev-server plugin that registers a local
 * HTTP endpoint (e.g. /__open-in-editor) which the React Insight UI calls to
 * open source files in the user's editor (VS Code, Cursor, WebStorm, etc.).
 *
 * Planned API (Phase 5):
 *   ```ts
 *   import { launchEditorPlugin } from '@react-insight/launch-editor/vite';
 *   // vite.config.ts
 *   plugins: [launchEditorPlugin({ editor: 'code' })]
 *   ```
 *
 *   ```ts
 *   import { launchEditorPlugin } from '@react-insight/launch-editor/webpack';
 *   // next.config.js / webpack.config.js
 *   ```
 *
 * For now this module is a stub that re-exports the launch-editor middleware
 * type — actual plugin implementations will land in Phase 5.
 */

export type { VitePlugin } from './vite';
