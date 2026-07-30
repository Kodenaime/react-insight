/**
 * Vite plugin for @react-insight/launch-editor.
 *
 * Injects the per-session token into connect middleware and passes it
 * to the client-side "Jump to Code" handler.
 */

import type { Plugin, ViteDevServer } from 'vite';
import { createLaunchEditorHandler } from './index';

let _token = '';

export interface ViteLaunchEditorOptions {
  /** Project root (auto-detected from Vite config). */
  projectRoot?: string;
  /** Editor to use. */
  editor?: string;
}

export function launchEditorPlugin(options?: ViteLaunchEditorOptions): Plugin {
  return {
    name: '@react-insight/launch-editor',
    apply: 'serve',
    configResolved(config) {
      const projectRoot = options?.projectRoot || config.root;
      const { handler, token } = createLaunchEditorHandler({
        projectRoot,
        editor: options?.editor,
        allowedOrigin: `http://localhost:${config.server.port || 5173}`,
      });
      _token = token;

      // Store for SSR / client injection
      (globalThis as any).__REACT_INSIGHT_LAUNCH_TOKEN__ = token;
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/__open-in-editor')) {
          // The handler is a full request listener, not connect middleware.
          // We wrap it: don't call next() if handled.
          return;
        }
        next();
      });
    },
    transformIndexHtml() {
      // Inject the token as a meta tag so the client can read it
      return [
        {
          tag: 'meta',
          attrs: {
            name: 'react-insight-launch-token',
            content: _token,
          },
        },
      ];
    },
  };
}
