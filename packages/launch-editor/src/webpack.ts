/**
 * Stub for future webpack dev-server middleware integration.
 *
 * Register:
 * ```js
 * // next.config.js or webpack.config.js
 * const { LaunchEditorWebpackPlugin } = require('@react-insight/launch-editor/webpack');
 * module.exports = { plugins: [new LaunchEditorWebpackPlugin()] };
 * ```
 *
 * The actual middleware registration depends on the webpack-dev-server version.
 * Full implementation requires accessing the devServer's app instance to mount
 * the /__open-in-editor handler. This varies between webpack-dev-server v3/v4.
 *
 * For now, consumers should use the standalone server or Vite plugin.
 */
export {};
