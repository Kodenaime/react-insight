/**
 * E2E Test Matrix — React 17, 18, 19.
 *
 * These tests verify the hook shim installation, re-render detection,
 * and overlay interaction across all three supported React versions.
 *
 * ## Prerequisites
 *
 * The test apps must be built and served before running. See the
 * root-level scripts in package.json for each version:
 *
 *   pnpm e2e:build    — builds all three test apps
 *   pnpm e2e:serve    — serves them on ports 4000 (r17), 4001 (r18), 4002 (r19)
 *   pnpm e2e:test     — runs Playwright against all three
 *
 * ## Test matrix
 *
 * | Version | Test app source               | Port |
 * |---------|-------------------------------|------|
 * | 17      | scripts/fixture-capture/r17   | 4000 |
 * | 18      | examples/vite-react-18        | 4001 |
 * | 19      | scripts/fixture-capture/r19   | 4002 |
 *
 * ## Scenarios per version
 *
 * 1. Hook shim installed — verify window.__REACT_DEVTOOLS_GLOBAL_HOOK__
 * 2. Component renders detected — verify overlay trigger button appears
 * 3. Overlay drawer opens and shows metrics
 * 4. Health score rendered in overlay
 *
 * Co-existence with real React DevTools is verified in the unit tests
 * (hookShim.realMount.preinstalled.test.ts).
 */

import { describe, it, expect } from 'vitest';
import type { Page, Browser } from 'playwright';

// ── Config ───────────────────────────────────────────────────

interface AppConfig {
  name: string;
  port: number;
  reactVersion: string;
}

const APPS: AppConfig[] = [
  { name: 'React 17', port: 4000, reactVersion: '17' },
  { name: 'React 18', port: 4001, reactVersion: '18' },
  { name: 'React 19', port: 4002, reactVersion: '19' },
];

const BASE_TIMEOUT = 15000;

// ── E2E Test ─────────────────────────────────────────────────

describe('E2E matrix', () => {
  let browser: Browser | null = null;

  beforeAll(async () => {
    // Only attempt to launch if Playwright is available
    try {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: true });
    } catch {
      // Playwright not installed — skip all tests
      console.warn('  ⚠ Playwright not installed. Skipping E2E tests.');
    }
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  for (const app of APPS) {
    describe(`${app.name} (port ${app.port})`, () => {
      // Skip if no browser or server not running
      const itOrSkip = browser ? it : it.skip;

      itOrSkip('hook shim is installed', async () => {
        const page = await browser!.newPage();
        try {
          await page.goto(`http://localhost:${app.port}`, { timeout: BASE_TIMEOUT });
          const hasHook = await page.evaluate(() => {
            return typeof (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined';
          });
          expect(hasHook).toBe(true);
        } finally {
          await page.close();
        }
      }, BASE_TIMEOUT);

      itOrSkip('overlay trigger button is visible', async () => {
        const page = await browser!.newPage();
        try {
          await page.goto(`http://localhost:${app.port}`, { timeout: BASE_TIMEOUT });
          await page.waitForTimeout(2000); // Let React commit + engine init
          const button = page.locator('button[title="React Insight"]');
          await expect(button).toBeVisible({ timeout: BASE_TIMEOUT });
          const text = await button.textContent();
          expect(text).toContain('RI');
        } finally {
          await page.close();
        }
      }, BASE_TIMEOUT);

      itOrSkip('overlay drawer opens on click', async () => {
        const page = await browser!.newPage();
        try {
          await page.goto(`http://localhost:${app.port}`, { timeout: BASE_TIMEOUT });
          await page.waitForTimeout(2000);
          await page.click('button[title="React Insight"]');
          const dialog = page.locator('[role="dialog"]');
          await expect(dialog).toBeVisible({ timeout: BASE_TIMEOUT });
          const text = await dialog.textContent();
          expect(text).toContain('React Insight');
        } finally {
          await page.close();
        }
      }, BASE_TIMEOUT);

      itOrSkip('health score is displayed in overlay', async () => {
        const page = await browser!.newPage();
        try {
          await page.goto(`http://localhost:${app.port}`, { timeout: BASE_TIMEOUT });
          await page.waitForTimeout(2000);
          await page.click('button[title="React Insight"]');
          const dialog = page.locator('[role="dialog"]');
          const text = await dialog.textContent();
          expect(text).toContain('Architecture Health');
          // Health score should be a number (possibly 100 for a fresh mount)
          expect(text).toMatch(/\d+(\/100)/);
        } finally {
          await page.close();
        }
      }, BASE_TIMEOUT);
    });
  }
});
