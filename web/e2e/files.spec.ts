import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { resolve } from 'node:path';

const repositoryPath = resolve(process.cwd(), '..');

test.beforeEach(async ({ request }) => {
  await resetConfig(request);
});

test.afterEach(async ({ request }) => {
  await resetConfig(request);
});

test('browses repository directories and preserves a file URL', async ({ page }) => {
  const query = new URLSearchParams({
    repoPath: repositoryPath,
    path: 'web/src/app',
  });
  const response = await page.goto('/files?' + query.toString());

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();
  const breadcrumbs = page.getByRole('navigation', { name: 'Repository path' });
  await expect(breadcrumbs.getByText('web', { exact: true })).toBeVisible();
  await expect(breadcrumbs.getByText('src', { exact: true })).toBeVisible();
  await expect(breadcrumbs.getByText('app', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open file routes.ts' })).toBeVisible();

  await page.getByRole('link', { name: 'Open file routes.ts' }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('path') === 'web/src/app/routes.ts');
  await expect(page.getByRole('heading', { name: 'routes.ts' })).toBeVisible();
  await expect(page.locator('.syntax-code .hljs-keyword').first()).toBeVisible();
  await expect(page.locator('.line-number-gutter')).toContainText('1');

  await page.reload();
  await expect(page).toHaveURL((url) => url.searchParams.get('path') === 'web/src/app/routes.ts');
  await expect(page.getByRole('heading', { name: 'routes.ts' })).toBeVisible();
  await expect(page.locator('.syntax-code .hljs-keyword').first()).toBeVisible();
  await expect(page.locator('mat-progress-bar')).toBeHidden();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations, formatViolations(accessibility.violations)).toEqual([]);

  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(documentOverflow).toBeLessThanOrEqual(1);

  await page.goBack();
  await expect(page).toHaveURL((url) => url.searchParams.get('path') === 'web/src/app');
  await expect(page.getByRole('link', { name: 'Open file routes.ts' })).toBeVisible();
});

test('opens files at the exact revision selected from the commit graph', async ({
  page,
  request,
}) => {
  const stateQuery = new URLSearchParams({ repoPath: repositoryPath, limit: '80' });
  const stateResponse = await request.get('/api/state?' + stateQuery.toString());
  expect(stateResponse.ok()).toBe(true);
  const repositoryState = (await stateResponse.json()) as {
    commits: Array<{ changeId: string; commitId: string; current: boolean }>;
  };
  const targetIndex = repositoryState.commits.findIndex((commit) => !commit.current);
  expect(targetIndex).toBeGreaterThanOrEqual(0);
  const target = repositoryState.commits[targetIndex];

  const query = new URLSearchParams({ repoPath: repositoryPath });
  await page.goto('/revisions?' + query.toString());
  const menuButtons = page.locator('.change-menu-button');
  await expect(menuButtons.nth(targetIndex)).toBeVisible();
  await menuButtons.nth(targetIndex).click();

  const filesResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/repo/files?'),
  );
  await page.getByRole('menuitem', { name: 'Show files' }).click();
  const filesResponse = await filesResponsePromise;

  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/files' &&
      url.searchParams.get('rev') === target.changeId &&
      url.searchParams.get('commitId') === target.commitId &&
      url.searchParams.get('path') == null
    );
  });
  const filesRequestURL = new URL(filesResponse.url());
  expect(filesRequestURL.searchParams.get('rev')).toBe(target.changeId);
  expect(filesRequestURL.searchParams.get('commitId')).toBe(target.commitId);
  const filesResult = (await filesResponse.json()) as { rev: string };
  expect(filesResult.rev).toBe(target.commitId);
  await expect(page.locator('.page-header p')).toContainText('Files at revision');
  await expect(page.getByRole('navigation', { name: 'Repository path' })).toBeVisible();
});

async function resetConfig(request: APIRequestContext): Promise<void> {
  const response = await request.put('/api/config', {
    data: {
      currentRepository: '',
      repositories: [],
      logRevset: '',
    },
  });
  expect(response.ok()).toBe(true);
}

function formatViolations(violations: Array<{ id: string; help: string }>): string {
  return violations.map((violation) => violation.id + ': ' + violation.help).join('\n');
}
