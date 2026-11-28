import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';

export async function captureCadReconstruction(
  page: Page,
  filename: string,
  directory = process.env.CAD_RECONSTRUCTION_EVIDENCE,
) {
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.locator('.geometry-editor').screenshot({
    path: resolve(directory, filename + '.png'),
    scale: 'css',
    animations: 'allow',
  });
}

export async function freezeConstructionFrame(view: Locator, time: number) {
  await view.locator('[data-construction-play-key]').evaluate((element, timeMs) => {
    for (const animation of element.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = timeMs;
    }
  }, time);
}
