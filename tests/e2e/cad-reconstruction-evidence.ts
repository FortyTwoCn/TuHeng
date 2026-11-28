import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

export async function captureCadReconstruction(page: Page, filename: string) {
  const directory = process.env.CAD_RECONSTRUCTION_EVIDENCE;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.locator('.geometry-editor').screenshot({
    path: resolve(directory, filename + '.png'),
    scale: 'css',
    animations: 'allow',
  });
}
