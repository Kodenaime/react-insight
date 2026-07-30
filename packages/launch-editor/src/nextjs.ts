/**
 * Stub for Next.js plugin integration.
 *
 * Register:
 * ```js
 * // next.config.mjs
 * import { withLaunchEditor } from '@react-insight/launch-editor/nextjs';
 * export default withLaunchEditor({});
 * ```
 *
 * Full implementation requires patching Next.js's dev server to mount the
 * /__open-in-editor middleware, similar to how @next/mdx works.
 * This varies by Next.js version and is deferred pending the API inspection.
 */
export {};
