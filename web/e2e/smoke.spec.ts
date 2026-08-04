import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('loads the embedded app with accessible core UI', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Weiff');
  await expect(page.getByText('Weiff', { exact: true }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');

  await page.evaluate(() => document.fonts.ready);
  const iconFont = await page
    .locator('.material-icons')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        family: style.fontFamily,
        size: style.fontSize,
        textWidth: range.getBoundingClientRect().width,
      };
    });
  expect(iconFont.family).toContain('Material Symbols Rounded Variable');
  expect(iconFont.size).toBe('24px');
  expect(iconFont.textWidth).toBeLessThanOrEqual(26);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations, formatViolations(accessibility.violations)).toEqual([]);
});

function formatViolations(violations: Array<{ id: string; help: string }>): string {
  return violations.map((violation) => `${violation.id}: ${violation.help}`).join('\n');
}
