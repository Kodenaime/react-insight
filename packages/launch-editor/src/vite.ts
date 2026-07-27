import type { Plugin } from 'vite';

/**
 * Vite plugin that registers a local IDE-launch endpoint.
 */
export interface LaunchEditorPluginOptions {
  /** Editor to open (e.g. 'code', 'cursor', 'webstorm'). Default: auto-detect */
  editor?: string;
}

export function launchEditorPlugin(_options?: LaunchEditorPluginOptions): Plugin {
  return {
    name: '@react-insight/launch-editor',
    apply: 'serve',
    configureServer(server) {
      // TODO register /__open-in-editor endpoint using launch-editor
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith('/__open-in-editor')) {
          // Stub — will handle file path resolution and editor launch
        }
        next();
      });
    },
  };
}

export type VitePlugin = ReturnType<typeof launchEditorPlugin>;
