import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { App } from './app';
import { Commit, RepositoryFilesResult } from './data/repo-api';
import { RepositoryConfig, RepositoryConfigStore } from './data/repository-config';
import { RevisionDashboardState } from './data/revision-dashboard-state';
import { routes } from './routes';

const settingsStorageKey = 'weiff.settings';
const themeStorageKey = 'weiff.theme';
const navigationStorageKey = 'weiff.navigation';

interface RepoState {
  repoPath: string;
  vcs: string;
  currentCommitId: string;
  commits: unknown[];
  graphRows: unknown[];
  generatedAt: string;
}

interface BookmarksResult {
  repoPath: string;
  vcs: string;
  bookmarks: unknown[];
  generatedAt: string;
}

interface RemotesResult {
  repoPath: string;
  vcs: string;
  remotes: { name: string; url: string }[];
  generatedAt: string;
}

interface WorkspacesResult {
  repoPath: string;
  vcs: string;
  workspaces: unknown[];
  generatedAt: string;
}

interface OperationLogResult {
  repoPath: string;
  vcs: string;
  operations: OperationFixture[];
  limit: number;
  hasMore: boolean;
  generatedAt: string;
}

interface OperationFixture {
  id: string;
  shortId: string;
  parents: string[];
  shortParents: string[];
  description: string;
  user: string;
  timestamp: string;
  current: boolean;
  snapshot: boolean;
  workspaceName: string;
  root: boolean;
  attributes: string;
}

type StateFixture = Partial<RepoState> & {
  bookmarks?: unknown[];
  workspaces?: unknown[];
};

interface CommitResult {
  repoPath: string;
  vcs: string;
  rev: string;
  commit: unknown;
  generatedAt: string;
}

interface DiffResult {
  repoPath: string;
  vcs: string;
  rev: string;
  command: string[];
  diff: string;
  files: unknown[];
  truncated: boolean;
  maxBytes: number;
  generatedAt: string;
}

interface EvolutionLogResult {
  repoPath: string;
  vcs: string;
  rev: string;
  entries: EvolutionEntry[];
  generatedAt: string;
}

interface EvolutionEntry {
  commitId: string;
  shortCommitId: string;
  changeId: string;
  shortChangeId: string;
  description: string;
  summary: string;
  authorName: string;
  authorEmail: string;
  authorTimestamp: string;
  operationId: string;
  shortOperationId: string;
  operationDescription: string;
  operationUser: string;
  operationTimestamp: string;
  predecessors: string[];
  shortPredecessors: string[];
  filesChanged: number;
  totalAdded: number;
  totalRemoved: number;
}

describe('App', () => {
  let http: HttpTestingController;
  let dialogResult: unknown;
  let dialogData: unknown;
  let dialogOpenCount: number;
  let configWrites: RepositoryConfig[];

  beforeEach(async () => {
    history.pushState(null, '', '/');
    localStorage.clear();
    document.documentElement.style.colorScheme = '';
    delete document.documentElement.dataset['theme'];
    dialogResult = undefined;
    dialogData = undefined;
    dialogOpenCount = 0;
    configWrites = [];
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        {
          provide: MatDialog,
          useValue: {
            open: (_component: unknown, config?: { data?: unknown }) => {
              dialogData = config?.data;
              dialogOpenCount++;
              return { afterClosed: () => of(dialogResult) };
            },
          },
        },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(async () => {
    await flushConfigWrites();
    await flushHealthIfPresent();
    await flushStateIfPresent();
    await flushCommitIfPresent();
    await flushDiffIfPresent();
    await flushBookmarksIfPresent();
    await flushWorkspacesIfPresent();
    await flushOperationsIfPresent();
    await flushRepositoryFilesIfPresent();
    await flushEvolutionIfPresent();
    http.verify({ ignoreCancelled: true });
    localStorage.clear();
    document.documentElement.style.colorScheme = '';
    delete document.documentElement.dataset['theme'];
  });

  it('should create the app', async () => {
    const fixture = await createApp();
    await flushState();
    await flushDiff();
    await settle(fixture);

    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the repository state and file diff', async () => {
    const fixture = await createApp();

    await flushState({
      repoPath: '/tmp/repo',
      currentCommitId: 'abc',
      commits: [
        {
          commitId: 'abc',
          shortCommitId: 'abc',
          changeId: 'change',
          shortChangeId: 'change',
          description: '',
          summary: 'current work',
          authorName: 'Ada',
          authorEmail: 'ada@example.com',
          authorTimestamp: '2026-06-17T12:00:00Z',
          current: true,
          empty: false,
          bookmarks: ['feature/ui'],
        },
      ],
      bookmarks: [{ name: 'feature/ui', target: 'abc', shortTarget: 'abc', present: true }],
    });
    await flushDiff({
      repoPath: '/tmp/repo',
      rev: 'abc',
      command: ['jj', 'diff', '--git'],
      diff: 'diff --git a/file b/file\n+new line\n',
      files: [
        {
          path: 'file',
          status: 'modified',
          statusChar: 'M',
          lines: [{ kind: 'added', content: '+new line' }],
        },
      ],
    });

    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const repoSelect = compiled.querySelector('.repo-select-field') as HTMLElement;
    expect(repoSelect.textContent).toContain('repo');
    expect(compiled.querySelectorAll('.repo-action-toggle-group mat-button-toggle').length).toBe(2);
    expect(compiled.querySelector('.repo-action-toggle-group')?.textContent).toContain('Fetch');
    expect(compiled.querySelector('.repo-action-toggle-group')?.textContent).toContain('Refresh');
    expect(compiled.textContent).toContain('current work');
    expect(compiled.textContent).toContain('file');
    expect(compiled.textContent).toContain('new line');
  });

  it('should navigate between the revisions page and routed pages', async () => {
    const fixture = await createApp();
    await flushState({ repoPath: '/tmp/repo' });
    await flushDiff({ repoPath: '/tmp/repo' });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const router = TestBed.inject(Router);
    expect(compiled.querySelector('app-commit-graph')).toBeTruthy();
    expect(router.url).toBe('/revisions');

    compiled.querySelector<HTMLAnchorElement>('a[aria-label="Bookmarks"]')?.click();
    for (let attempt = 0; attempt < 50 && router.url !== '/bookmarks'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve));
      await flushBookmarksIfPresent();
      fixture.detectChanges();
    }
    await settle(fixture);

    expect(router.url).toBe('/bookmarks');
    expect(compiled.textContent).toContain('Bookmarks');
    expect(compiled.querySelector('app-commit-graph')).toBeFalsy();

    await router.navigateByUrl('/revisions');
    fixture.detectChanges();
    await flushState({ repoPath: '/tmp/repo' });
    await flushDiff({ repoPath: '/tmp/repo' });
    await settle(fixture);

    expect(router.url).toBe('/revisions');
    expect(compiled.querySelector('app-commit-graph')).toBeTruthy();
  });

  it('should browse repository files using the path query', async () => {
    history.pushState(null, '', '/files?repoPath=%2Ftmp%2Frepo&path=src');

    const fixture = await createApp();
    const directoryRequests = await waitForRequests('/api/repo/files');
    expect(queryParam(directoryRequests[0].request.urlWithParams, 'repoPath')).toBe('/tmp/repo');
    expect(queryParam(directoryRequests[0].request.urlWithParams, 'rev')).toBe('@');
    expect(queryParam(directoryRequests[0].request.urlWithParams, 'path')).toBe('src');
    directoryRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: '1234567890abcdef',
      path: 'src',
      kind: 'directory',
      entries: [{ name: 'main.go', path: 'src/main.go', kind: 'file' }],
      generatedAt: '2026-08-03T12:00:00Z',
    } satisfies RepositoryFilesResult);
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const router = TestBed.inject(Router);
    expect(compiled.querySelector('app-files-page')).toBeTruthy();
    expect(compiled.querySelector('.breadcrumbs')?.textContent).toContain('src');
    expect(compiled.querySelector('.file-entry')?.textContent).toContain('main.go');
    expect(
      Array.from(compiled.querySelectorAll('mat-nav-list[aria-label="Primary navigation"] a')).map(
        (link) => link.getAttribute('aria-label'),
      ),
    ).toEqual(['Revisions', 'Files', 'Bookmarks', 'Workspaces', 'Operation Log']);
    expect(
      compiled.querySelector<HTMLAnchorElement>('a[aria-label="Files"]')?.getAttribute('href'),
    ).not.toContain('path=');

    compiled.querySelector<HTMLAnchorElement>('.file-entry')?.click();
    for (
      let attempt = 0;
      attempt < 50 && queryParam(router.url, 'path') !== 'src/main.go';
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve));
    }

    const fileRequests = await waitForRequests('/api/repo/files');
    expect(queryParam(fileRequests[0].request.urlWithParams, 'path')).toBe('src/main.go');
    fileRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: '1234567890abcdef',
      path: 'src/main.go',
      kind: 'file',
      entries: [],
      content: 'package main\n\nfunc main() {}\n',
      maxBytes: 1024 * 1024,
      generatedAt: '2026-08-03T12:00:00Z',
    } satisfies RepositoryFilesResult);
    await settle(fixture);

    expect(queryParam(router.url, 'path')).toBe('src/main.go');
    expect(compiled.querySelector('.file-heading h2')?.textContent).toContain('main.go');
    expect(compiled.querySelector('.syntax-code .hljs-keyword')?.textContent).toBe('package');
    expect(compiled.querySelector('.line-number-gutter')?.textContent).toBe('1\n2\n3');

    TestBed.inject(RevisionDashboardState).refresh();
    const refreshRequests = await waitForRequests('/api/repo/files');
    expect(queryParam(refreshRequests[0].request.urlWithParams, 'path')).toBe('src/main.go');
    refreshRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: '1234567890abcdef',
      path: 'src/main.go',
      kind: 'file',
      entries: [],
      content: 'package main\n',
      maxBytes: 1024 * 1024,
      generatedAt: '2026-08-03T12:00:01Z',
    } satisfies RepositoryFilesResult);
    await settle(fixture);
  });

  it('should request an exact historical file revision and reset it from primary navigation', async () => {
    history.pushState(null, '', '/files?repoPath=%2Ftmp%2Frepo&rev=feature-change&commitId=abc123');

    const fixture = await createApp();
    const requests = await waitForRequests('/api/repo/files');
    expect(queryParam(requests[0].request.urlWithParams, 'rev')).toBe('feature-change');
    expect(queryParam(requests[0].request.urlWithParams, 'commitId')).toBe('abc123');
    requests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: 'abc123',
      path: '',
      kind: 'directory',
      entries: [],
      generatedAt: '2026-08-03T12:00:00Z',
    } satisfies RepositoryFilesResult);
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.page-header p')?.textContent).toContain('Files at revision');
    const filesURL = new URL(
      compiled.querySelector<HTMLAnchorElement>('a[aria-label="Files"]')?.href ?? '',
      globalThis.location.origin,
    );
    expect(filesURL.searchParams.get('rev')).toBeNull();
    expect(filesURL.searchParams.get('commitId')).toBeNull();
  });

  it('should group reachable and remote-only bookmarks on the bookmarks page', async () => {
    history.pushState(null, '', '/bookmarks');

    const fixture = await createApp();
    await flushBookmarksIfPresent({
      repoPath: '/tmp/repo',
      bookmarks: [
        {
          name: 'main',
          target: 'abc',
          shortTarget: 'abc',
          present: true,
          conflict: false,
          tracked: false,
          synced: false,
        },
        {
          name: 'feature',
          remote: 'origin',
          target: 'def',
          shortTarget: 'def',
          present: true,
          conflict: false,
          tracked: true,
          synced: false,
        },
        {
          name: 'nebius',
          target: 'ghi',
          shortTarget: 'ghi',
          present: true,
          conflict: false,
          tracked: false,
          synced: false,
        },
        {
          name: 'nebius',
          remote: 'origin',
          target: 'jkl',
          shortTarget: 'jkl',
          present: true,
          conflict: false,
          tracked: true,
          synced: false,
        },
        {
          name: 'teammate',
          remote: 'origin',
          target: 'fed',
          shortTarget: 'fed',
          present: true,
          conflict: false,
          tracked: false,
          synced: false,
        },
      ],
    });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Reachable');
    expect(compiled.textContent).toContain('Other remote');
    expect(compiled.textContent).toContain('main');
    expect(compiled.textContent).toContain('feature');
    expect(compiled.textContent).toContain('teammate');
    expect(compiled.textContent).toContain('Remote');
    expect(compiled.textContent).not.toContain('/tmp/repo');
    expect(compiled.querySelectorAll('.bookmark-row').length).toBe(4);
    expect(
      Array.from(compiled.querySelectorAll('.bookmark-row')).filter((row) =>
        row.textContent?.includes('nebius'),
      ).length,
    ).toBe(1);

    const teammateRow = Array.from(compiled.querySelectorAll<HTMLElement>('.bookmark-row')).find(
      (row) => row.textContent?.includes('teammate'),
    );
    expect(teammateRow).toBeTruthy();
    teammateRow
      ?.querySelector<HTMLButtonElement>('button[aria-label^="Bookmark actions"]')
      ?.click();
    await settle(fixture);

    expect(menuButton('Open revision')).toBeTruthy();
    expect(menuButton('New from this')).toBeTruthy();
    expect(menuButton('Move to selected')).toBeFalsy();
    expect(menuButton('Push')).toBeFalsy();
    menuButton('New from this')?.click();

    const newRequests = await waitForRequests('/api/changes/new');
    expect(newRequests[0].request.method).toBe('POST');
    expect(newRequests[0].request.body).toEqual({ rev: 'fed', repoPath: '/tmp/repo' });
    newRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      command: ['jj', 'new', 'fed'],
      message: 'created',
      generatedAt: '2026-06-17T12:00:00Z',
    });
    await flushBookmarksIfPresent({ repoPath: '/tmp/repo' });
    await settle(fixture);
  });

  it('should push to a chosen remote when the repository has multiple remotes', async () => {
    history.pushState(null, '', '/bookmarks');

    const fixture = await createApp();
    await flushBookmarksIfPresent({
      repoPath: '/tmp/repo',
      bookmarks: [
        {
          name: 'feature',
          target: 'abc',
          shortTarget: 'abc',
          present: true,
          conflict: false,
          tracked: false,
          synced: false,
        },
        {
          name: 'feature',
          remote: 'origin',
          target: 'abc',
          shortTarget: 'abc',
          present: true,
          conflict: false,
          tracked: true,
          synced: true,
        },
      ],
    });
    await flushRemotesIfPresent({
      repoPath: '/tmp/repo',
      remotes: [
        { name: 'origin', url: 'git@example.com:repo.git' },
        { name: 'upstream', url: 'git@example.com:upstream.git' },
      ],
    });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    compiled.querySelector<HTMLButtonElement>('button[aria-label^="Bookmark actions"]')?.click();
    await settle(fixture);

    menuButton('Push')?.click();
    await settle(fixture);

    expect(menuButton('Push to origin')).toBeTruthy();
    const upstreamButton = menuButton('Push to upstream (new)');
    expect(upstreamButton).toBeTruthy();
    upstreamButton?.click();

    const pushRequests = await waitForRequests('/api/bookmarks/feature/push');
    expect(pushRequests[0].request.method).toBe('POST');
    expect(pushRequests[0].request.body).toEqual({
      repoPath: '/tmp/repo',
      remote: 'upstream',
      allowNew: true,
    });
    pushRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      command: ['jj', 'git', 'push', '-b', 'feature', '--remote', 'upstream', '--allow-new'],
      message: 'pushed',
      generatedAt: '2026-06-17T12:00:00Z',
    });

    await flushBookmarksIfPresent({ repoPath: '/tmp/repo' });
    await settle(fixture);
  });

  it('should render workspaces and create a workspace from the selected revision', async () => {
    history.pushState(null, '', '/workspaces');

    const fixture = await createApp();
    await flushWorkspacesIfPresent({
      repoPath: '/tmp/repo',
      workspaces: [
        {
          name: 'default',
          root: '/tmp/repo',
          target: 'abc',
          shortTarget: 'abc',
          changeId: 'changeabc',
          shortChangeId: 'changeabc',
          description: 'current work',
          summary: 'current work',
          current: true,
        },
      ],
    });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Workspaces');
    expect(compiled.textContent).toContain('/tmp/repo');
    expect(compiled.querySelectorAll('.workspace-card').length).toBe(1);
    expect(compiled.querySelector('table')).toBeFalsy();

    dialogResult = {
      destination: '/tmp/repo-feature',
      name: 'feature',
      rev: '@',
      sparsePatterns: 'copy',
    };
    const addWorkspaceButton = Array.from(
      compiled.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.includes('Add workspace'));
    expect(addWorkspaceButton).toBeTruthy();
    addWorkspaceButton?.click();
    await settle(fixture);

    expect(dialogData).toEqual({ parentRev: '@', parentLabel: '@' });
    const requests = await waitForRequests('/api/workspaces');
    expect(requests[0].request.method).toBe('POST');
    expect(requests[0].request.body).toEqual({
      destination: '/tmp/repo-feature',
      name: 'feature',
      rev: '@',
      sparsePatterns: 'copy',
      repoPath: '/tmp/repo',
    });
    requests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      command: ['jj', 'workspace', 'add'],
      message: 'created',
      generatedAt: '2026-06-17T12:00:00Z',
    });

    const workspaceReload = {
      repoPath: '/tmp/repo',
      workspaces: [
        {
          name: 'default',
          root: '/tmp/repo',
          target: 'abc',
          shortTarget: 'abc',
          changeId: 'changeabc',
          shortChangeId: 'changeabc',
          description: 'current work',
          summary: 'current work',
          current: true,
        },
        {
          name: 'feature',
          root: '/tmp/repo-feature',
          target: 'def',
          shortTarget: 'def',
          changeId: 'changedef',
          shortChangeId: 'changedef',
          description: 'feature work',
          summary: 'feature work',
          current: false,
        },
      ],
    } satisfies StateFixture;
    await flushStateIfPresent(workspaceReload);
    await flushDiffIfPresent({ repoPath: '/tmp/repo' });
    await flushWorkspacesIfPresent(workspaceReload);
    for (let attempt = 0; attempt < 3; attempt++) {
      await flushHealthIfPresent();
      await flushWorkspacesIfPresent(workspaceReload);
      fixture.detectChanges();
      await Promise.resolve();
    }

    expect(compiled.textContent).toContain('/tmp/repo-feature');
  });

  it('should render the operation log page and reload it from the toolbar', async () => {
    history.pushState(null, '', '/operation-log');

    const fixture = await createApp();
    await flushOperationsIfPresent({
      repoPath: '/tmp/repo',
      operations: [
        operationEntry({
          id: '1234567890abcdef',
          shortId: '1234567890ab',
          parents: ['abcdef1234567890'],
          shortParents: ['abcdef123456'],
          description: 'snapshot working copy',
          user: 'ada@example.com',
          current: true,
          snapshot: true,
          attributes: 'args: jj status',
        }),
        operationEntry({
          id: 'fedcba0987654321',
          shortId: 'fedcba098765',
          description: 'rebase commit',
          user: 'grace@example.com',
          workspaceName: 'feature@',
        }),
        ...Array.from({ length: 10 }, (_, index) =>
          operationEntry({
            id: `extra-${index}`,
            shortId: `extra-${index}`,
            description: `extra operation ${index}`,
          }),
        ),
      ],
    });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-commit-graph')).toBeFalsy();
    expect(compiled.textContent).toContain('Operation Log');
    expect(compiled.textContent).toContain('snapshot working copy');
    expect(compiled.textContent).toContain('ada');
    expect(compiled.textContent).toContain('status');
    expect(compiled.textContent).toContain('args: jj status');
    expect(
      compiled.querySelector<HTMLInputElement>(
        'input[placeholder="Search operations, users, commands, or IDs"]',
      ),
    ).toBeTruthy();
    expect(compiled.querySelector('button[aria-label="Refresh operation log"]')).toBeFalsy();
    expect(
      Array.from(compiled.querySelectorAll('th')).some(
        (header) => header.textContent?.trim() === 'Command',
      ),
    ).toBe(false);
    expect(compiled.querySelectorAll('.operation-row').length).toBe(10);
    expect(compiled.querySelector<HTMLElement>('mat-paginator')?.textContent).toContain('1 – 10');

    compiled.querySelector<HTMLButtonElement>('button[aria-label^="Operation actions"]')?.click();
    await settle(fixture);
    expect(menuButton('Copy operation ID')).toBeTruthy();
    expect(menuButton('Copy command')).toBeTruthy();
    expect(menuButton('Copy parent IDs')).toBeTruthy();
    expect(menuButton('Restore here')).toBeTruthy();
    menuButton('Copy operation ID')?.click();
    await settle(fixture);

    const secondRowAction = compiled
      .querySelectorAll<HTMLElement>('.operation-row')[1]
      ?.querySelector<HTMLButtonElement>('button[aria-label^="Operation actions"]');
    secondRowAction?.click();
    await settle(fixture);
    const restoreButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .reverse()
      .find((button) => button.textContent?.includes('Restore here'));
    expect(restoreButton?.disabled).toBe(false);
    dialogResult = true;
    restoreButton?.click();
    await settle(fixture);

    const restoreRequests = await waitForRequests('/api/operations/fedcba0987654321/restore');
    expect(restoreRequests[0].request.method).toBe('POST');
    expect(restoreRequests[0].request.body).toEqual({ repoPath: '/tmp/repo' });
    restoreRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      command: ['jj', 'op', 'restore', 'fedcba0987654321'],
      message: 'restored',
      generatedAt: '2026-06-17T12:00:00Z',
    });
    await settle(fixture);
    const restoreReloadRequests = await waitForRequests('/api/operations');
    expect(restoreReloadRequests[0].request.method).toBe('GET');
    restoreReloadRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      operations: [],
      limit: 50,
      hasMore: false,
      generatedAt: '2026-06-17T12:00:00Z',
    });
    await settle(fixture);

    const undoButton = Array.from(compiled.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Undo last operation'),
    );
    expect(undoButton).toBeTruthy();
    undoButton?.click();
    await settle(fixture);

    const undoRequests = await waitForRequests('/api/operations/undo');
    expect(undoRequests[0].request.method).toBe('POST');
    expect(undoRequests[0].request.body).toEqual({ repoPath: '/tmp/repo' });
    undoRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      command: ['jj', 'undo'],
      message: 'undone',
      generatedAt: '2026-06-17T12:00:00Z',
    });
    await settle(fixture);
    const undoReloadRequests = await waitForRequests('/api/operations');
    expect(undoReloadRequests[0].request.method).toBe('GET');
    undoReloadRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      operations: [],
      generatedAt: '2026-06-17T12:00:00Z',
    });
    await settle(fixture);

    const refreshToggle = Array.from(
      compiled.querySelectorAll<HTMLElement>('.repo-action-toggle'),
    ).find((button) => button.textContent?.includes('Refresh'));
    expect(refreshToggle).toBeTruthy();
    refreshToggle?.click();
    await settle(fixture);

    const requests = await waitForRequests('/api/operations');
    expect(requests[0].request.method).toBe('GET');
    expect(queryParam(requests[0].request.urlWithParams, 'limit')).toBe('50');
    requests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      operations: [],
      limit: 50,
      hasMore: false,
      generatedAt: '2026-06-17T12:00:00Z',
    });
    await settle(fixture);
  });

  it('should collapse the navigation drawer to icon-only mode', async () => {
    const fixture = await createApp();
    await flushState({ repoPath: '/tmp/repo' });
    await flushDiff({ repoPath: '/tmp/repo' });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const drawer = compiled.querySelector<HTMLElement>('.navigation-drawer');
    const collapseButton = compiled.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse navigation"]',
    );
    const activeRailItem = compiled.querySelector<HTMLElement>('a[aria-current="page"]');
    expect(drawer?.style.width).toBe('220px');
    expect(collapseButton?.textContent).toContain('menu_open');
    expect(activeRailItem?.classList.contains('mdc-list-item--activated')).toBe(true);

    collapseButton?.click();
    await settle(fixture);

    expect(drawer?.style.width).toBe('80px');
    expect(drawer?.textContent).not.toContain('Operation Log');
    expect(activeRailItem?.classList.contains('mdc-list-item--activated')).toBe(true);
    expect(localStorage.getItem(navigationStorageKey)).toBe('collapsed');
    expect(
      compiled.querySelector<HTMLButtonElement>('button[aria-label="Expand navigation"]')
        ?.textContent,
    ).toContain('menu');

    compiled.querySelector<HTMLButtonElement>('button[aria-label="Expand navigation"]')?.click();
    await settle(fixture);

    expect(drawer?.style.width).toBe('220px');
    expect(localStorage.getItem(navigationStorageKey)).toBe('expanded');
  });

  it('should initialize the navigation drawer mode from localStorage', async () => {
    localStorage.setItem(navigationStorageKey, 'collapsed');

    const fixture = await createApp();
    await flushState({ repoPath: '/tmp/repo' });
    await flushDiff({ repoPath: '/tmp/repo' });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector<HTMLElement>('.navigation-drawer')?.style.width).toBe('80px');
    expect(
      compiled.querySelector<HTMLButtonElement>('button[aria-label="Expand navigation"]'),
    ).toBeTruthy();
  });

  it('should send the selected repository path to state and diff requests', async () => {
    const fixture = await createApp();
    await flushState({ repoPath: '/tmp/repo' });
    await flushDiff();
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    dialogResult = { path: '/tmp/other' };
    openRepoSelect(compiled);
    await settle(fixture);
    menuOption('Open repository...')?.click();
    await settle(fixture);

    const stateRequests = await waitForRequests('/api/state');
    expect(queryParam(stateRequests[0].request.urlWithParams, 'repoPath')).toBe('/tmp/other');
    stateRequests[0].flush({
      repoPath: '/tmp/other',
      vcs: 'jj',
      currentCommitId: '@',
      commits: [],
      graphRows: [],
      generatedAt: '2026-06-17T12:00:00Z',
    });

    const diffRequests = await waitForRequests('/api/diff');
    expect(queryParam(diffRequests[0].request.urlWithParams, 'repoPath')).toBe('/tmp/other');
    diffRequests[0].flush({
      repoPath: '/tmp/other',
      vcs: 'jj',
      rev: '@',
      command: [],
      diff: '',
      files: [],
      generatedAt: '2026-06-17T12:00:00Z',
    });

    await settle(fixture);

    openRepoSelect(compiled);
    await settle(fixture);

    expect(menuOptionTexts().some((text) => text.includes('Default repository'))).toBe(false);
    const matchingRepoOptions = menuOptionTexts().filter((text) => text.includes('/tmp/other'));
    expect(matchingRepoOptions.length).toBe(1);
  });

  it('should reopen the dialog after cancelling Open repository...', async () => {
    const fixture = await createApp();
    await flushState({ repoPath: '/tmp/repo' });
    await flushDiff();
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    dialogResult = undefined;
    openRepoSelect(compiled);
    await settle(fixture);
    menuOption('Open repository...')?.click();
    await settle(fixture);

    expect(dialogOpenCount).toBe(1);

    openRepoSelect(compiled);
    await settle(fixture);
    menuOption('Open repository...')?.click();
    await settle(fixture);

    expect(dialogOpenCount).toBe(2);
  });

  it('should send the log revset to state requests', async () => {
    const fixture = await createApp();
    await flushState({ repoPath: '/tmp/repo' });
    await flushDiff();
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const revsetInput = compiled.querySelector('.revset-field input') as HTMLInputElement;
    revsetInput.value = 'description(feat)';
    revsetInput.dispatchEvent(new Event('input'));

    const form = compiled.querySelector('.revset-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    await settle(fixture);

    const stateRequests = await waitForRequests('/api/state');
    expect(queryParam(stateRequests[0].request.urlWithParams, 'revset')).toBe('description(feat)');
    stateRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      currentCommitId: '@',
      commits: [],
      graphRows: [],
      generatedAt: '2026-06-17T12:00:00Z',
    });

    await settle(fixture);
  });

  it('should initialize the repository path from the URL query', async () => {
    history.pushState(null, '', '/?repoPath=%2Ftmp%2Ffrom-query');

    const fixture = await createApp();

    const stateRequests = await waitForRequests('/api/state');
    expect(queryParam(stateRequests[0].request.urlWithParams, 'repoPath')).toBe('/tmp/from-query');
    stateRequests[0].flush({
      repoPath: '/tmp/from-query',
      vcs: 'jj',
      currentCommitId: '@',
      commits: [],
      graphRows: [],
      generatedAt: '2026-06-17T12:00:00Z',
    });

    const diffRequests = await waitForRequests('/api/diff');
    expect(queryParam(diffRequests[0].request.urlWithParams, 'repoPath')).toBe('/tmp/from-query');
    diffRequests[0].flush({
      repoPath: '/tmp/from-query',
      vcs: 'jj',
      rev: '@',
      command: [],
      diff: '',
      files: [],
      generatedAt: '2026-06-17T12:00:00Z',
    });

    await settle(fixture);

    const repoSelect = fixture.nativeElement.querySelector('.repo-select-field') as HTMLElement;
    expect(repoSelect.textContent).toContain('from-query');
  });

  it('should initialize the selected revision from a change id in the URL query', async () => {
    history.pushState(null, '', '/?rev=changedef');

    const fixture = await createApp();

    await flushState({
      repoPath: '/tmp/repo',
      currentCommitId: 'abc',
      commits: [
        {
          commitId: 'abc',
          shortCommitId: 'abc',
          changeId: 'changeabc',
          shortChangeId: 'changeabc',
          description: 'current work',
          summary: 'current work',
          authorName: 'Ada',
          authorEmail: 'ada@example.com',
          authorTimestamp: '2026-06-17T12:00:00Z',
          current: true,
          empty: false,
          bookmarks: [],
        },
        {
          commitId: 'def',
          shortCommitId: 'def',
          changeId: 'changedef',
          shortChangeId: 'changedef',
          description: 'selected work',
          summary: 'selected work',
          authorName: 'Grace',
          authorEmail: 'grace@example.com',
          authorTimestamp: '2026-06-18T12:00:00Z',
          current: false,
          empty: false,
          bookmarks: [],
        },
      ],
    });

    const diffRequests = await waitForRequests('/api/diff');
    expect(queryParam(diffRequests[0].request.urlWithParams, 'rev')).toBe('changedef');
    diffRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: 'changedef',
      command: [],
      diff: '',
      files: [],
      generatedAt: '2026-06-17T12:00:00Z',
    });

    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const router = TestBed.inject(Router);
    expect(compiled.textContent).toContain('selected work');
    expect(queryParam(router.url, 'rev')).toBe('changedef');
    expect(queryParam(router.url, 'commitId')).toBe('def');
  });

  it('should load change info for a selected revision outside the graph', async () => {
    history.pushState(null, '', '/revisions?rev=remotecommit');

    const fixture = await createApp();

    await flushState({
      repoPath: '/tmp/repo',
      currentCommitId: 'abc',
      commits: [
        {
          commitId: 'abc',
          shortCommitId: 'abc',
          changeId: 'changeabc',
          shortChangeId: 'changeabc',
          description: 'current work',
          summary: 'current work',
          authorName: 'Ada',
          authorEmail: 'ada@example.com',
          authorTimestamp: '2026-06-17T12:00:00Z',
          current: true,
          empty: false,
          bookmarks: [],
        },
      ],
    });
    fixture.detectChanges();
    await Promise.resolve();
    await flushCommitIfPresent({
      repoPath: '/tmp/repo',
      rev: 'remotecommit',
      commit: {
        commitId: 'remotecommit',
        shortCommitId: 'remotecommit',
        changeId: 'remotechange',
        shortChangeId: 'remotechange',
        description: 'remote work\n\nbody',
        summary: 'remote work',
        authorName: 'Grace',
        authorEmail: 'grace@example.com',
        authorTimestamp: '2026-06-18T12:00:00Z',
        current: false,
        empty: false,
        bookmarks: [],
      },
    });
    await flushDiffIfPresent({ repoPath: '/tmp/repo', rev: 'remotechange' });
    await flushEvolutionIfPresent({ repoPath: '/tmp/repo', rev: 'remotechange' });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const router = TestBed.inject(Router);
    expect(compiled.textContent).toContain('remote work');
    expect(compiled.textContent).toContain('Grace');
    expect(compiled.textContent).not.toContain('Select a commit to inspect');
    expect(queryParam(router.url, 'rev')).toBe('remotechange');
    expect(queryParam(router.url, 'commitId')).toBe('remotecommit');
  });

  it('should write the selected change and commit ids to the URL query', async () => {
    const fixture = await createApp();

    await flushState({
      repoPath: '/tmp/repo',
      currentCommitId: 'abc',
      commits: [
        {
          commitId: 'abc',
          shortCommitId: 'abc',
          changeId: 'changeabc',
          shortChangeId: 'changeabc',
          description: 'current work',
          summary: 'current work',
          authorName: 'Ada',
          authorEmail: 'ada@example.com',
          authorTimestamp: '2026-06-17T12:00:00Z',
          current: true,
          empty: false,
          bookmarks: [],
        },
        {
          commitId: 'def',
          shortCommitId: 'def',
          changeId: 'changedef',
          shortChangeId: 'changedef',
          description: 'selected work',
          summary: 'selected work',
          authorName: 'Grace',
          authorEmail: 'grace@example.com',
          authorTimestamp: '2026-06-18T12:00:00Z',
          current: false,
          empty: false,
          bookmarks: [],
        },
      ],
    });
    await flushDiff({ repoPath: '/tmp/repo' });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const selectableCommits = compiled.querySelectorAll<HTMLElement>(
      '.change-group[role="option"]',
    );
    selectableCommits[1].click();
    await settle(fixture);

    const diffRequests = await waitForRequests('/api/diff');
    expect(queryParam(diffRequests[0].request.urlWithParams, 'rev')).toBe('changedef');
    expect(queryParam(diffRequests[0].request.urlWithParams, 'commitId')).toBe('def');
    const router = TestBed.inject(Router);
    expect(queryParam(router.url, 'rev')).toBe('changedef');
    expect(queryParam(router.url, 'commitId')).toBe('def');
    diffRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: 'changedef',
      command: [],
      diff: '',
      files: [],
      generatedAt: '2026-06-17T12:00:00Z',
    });
    await flushEvolutionIfPresent();

    await settle(fixture);
  });

  it('should restore the selected revision when the router URL changes', async () => {
    history.pushState(null, '', '/revisions?rev=changea&commitId=commita');
    const commits = [
      revisionCommit('commita', 'changea', { summary: 'revision A' }),
      revisionCommit('commitb', 'changeb', { summary: 'revision B' }),
    ];
    const fixture = await createApp();
    await flushState({
      repoPath: '/tmp/repo',
      currentCommitId: 'commita',
      commits,
    });
    await flushDiff({ repoPath: '/tmp/repo', rev: 'commita' });
    await settle(fixture);

    const router = TestBed.inject(Router);
    const dashboard = TestBed.inject(RevisionDashboardState);
    expect(dashboard.selectedCommit()?.commitId).toBe('commita');

    await router.navigateByUrl('/revisions?rev=changeb&commitId=commitb');
    const revisionBDiff = await waitForDiffRequest('changeb', 'commitb');
    revisionBDiff.flush(emptyDiff('commitb'));
    await settle(fixture);
    expect(dashboard.selectedCommit()?.commitId).toBe('commitb');

    await router.navigateByUrl('/revisions?rev=changea&commitId=commita');

    const revisionADiff = await waitForDiffRequest('changea', 'commita');
    revisionADiff.flush(emptyDiff('commita'));
    await settle(fixture);

    expect(queryParam(router.url, 'rev')).toBe('changea');
    expect(queryParam(router.url, 'commitId')).toBe('commita');
    expect(dashboard.selectedCommit()?.commitId).toBe('commita');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('revision A');
  });

  it('should retain the rewritten commit when its change later diverges', async () => {
    history.pushState(null, '', '/revisions?rev=sharedchange&commitId=oldcommit');
    const rewrittenCommit = revisionCommit('newcommit', 'sharedchange', {
      summary: 'rewritten revision',
    });
    const fixture = await createApp();
    await flushState({
      repoPath: '/tmp/repo',
      currentCommitId: 'newcommit',
      commits: [rewrittenCommit],
    });

    const rewrittenDiff = await waitForDiffRequest('sharedchange', 'newcommit');
    rewrittenDiff.flush(emptyDiff('newcommit'));
    await settle(fixture);

    const router = TestBed.inject(Router);
    const dashboard = TestBed.inject(RevisionDashboardState);
    expect(queryParam(router.url, 'commitId')).toBe('newcommit');
    expect(dashboard.selectedCommit()?.commitId).toBe('newcommit');

    dashboard.refresh();
    await flushState({
      repoPath: '/tmp/repo',
      currentCommitId: 'newcommit',
      commits: [
        { ...rewrittenCommit, divergent: true, changeOffset: 0 },
        revisionCommit('othercommit', 'sharedchange', {
          summary: 'other divergent revision',
          divergent: true,
          changeOffset: 1,
        }),
      ],
    });

    const divergentDiff = await waitForDiffRequest('sharedchange', 'newcommit');
    divergentDiff.flush(emptyDiff('newcommit'));
    await settle(fixture);

    expect(queryParam(router.url, 'commitId')).toBe('newcommit');
    expect(dashboard.selectedCommit()?.commitId).toBe('newcommit');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('rewritten revision');
  });

  it('should persist the selected repository and log revset', async () => {
    const fixture = await createApp();
    await flushState({ repoPath: '/tmp/repo' });
    await flushDiff();
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    dialogResult = { path: '/tmp/other', name: 'Other repo' };
    openRepoSelect(compiled);
    await settle(fixture);
    menuOption('Open repository...')?.click();
    await settle(fixture);

    await flushState({ repoPath: '/tmp/other' });
    await flushDiff({ repoPath: '/tmp/other' });
    await settle(fixture);

    const revsetInput = compiled.querySelector('.revset-field input') as HTMLInputElement;
    revsetInput.value = 'description(feat)';
    revsetInput.dispatchEvent(new Event('input'));
    (compiled.querySelector('.revset-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    await flushState({ repoPath: '/tmp/other' });
    await settle(fixture);

    await flushConfigWrites();
    const persisted = configWrites.at(-1);
    expect(persisted?.currentRepository).toBe('/tmp/other');
    expect(persisted?.repositories).toContainEqual({ path: '/tmp/other', name: 'Other repo' });
    expect(persisted?.logRevset).toBe('description(feat)');
  });

  it('should forget remembered repositories one at a time', async () => {
    const fixture = await createApp({
      currentRepository: '/tmp/current',
      repositories: [{ path: '/tmp/current' }, { path: '/tmp/old' }],
    });
    await flushState({ repoPath: '/tmp/current' });
    await flushDiff({ repoPath: '/tmp/current' });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    openRepoSelect(compiled);
    await settle(fixture);
    document.body
      .querySelector<HTMLButtonElement>('button[aria-label="Forget repository /tmp/old"]')
      ?.click();
    await settle(fixture);

    await flushConfigWrites();
    const persisted = configWrites.at(-1);
    expect(persisted?.currentRepository).toBe('/tmp/current');
    expect(persisted?.repositories).toContainEqual({ path: '/tmp/current' });
    expect(persisted?.repositories).not.toContainEqual({ path: '/tmp/old' });
  });

  it('should initialize diff view settings from localStorage', async () => {
    localStorage.setItem(settingsStorageKey, JSON.stringify({ diffMode: 'split' }));
    localStorage.setItem(themeStorageKey, 'dark');

    const fixture = await createApp();
    await flushState({ repoPath: '/tmp/repo' });
    await flushDiff({
      repoPath: '/tmp/repo',
      files: [
        {
          path: 'file.txt',
          status: 'modified',
          statusChar: 'M',
          conflict: false,
          lines: [
            { kind: 'removed', content: '-old' },
            { kind: 'added', content: '+new' },
          ],
        },
      ],
    });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    compiled.querySelector<HTMLElement>('.file-panel mat-expansion-panel-header')?.click();
    await settle(fixture);

    expect(compiled.querySelector('.split-output')).toBeTruthy();
    expect(compiled.querySelector('.diff-output')).toBeFalsy();
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('should navigate to the settings page from the navigation drawer', async () => {
    const fixture = await createApp();
    await flushState({ repoPath: '/tmp/repo' });
    await flushDiff({ repoPath: '/tmp/repo' });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.app-toolbar button[aria-label="Settings"]')).toBeFalsy();
    compiled
      .querySelector<HTMLAnchorElement>('.navigation-drawer a[aria-label="Settings"]')
      ?.click();
    await settle(fixture);

    expect(TestBed.inject(Router).url).toBe('/settings');
    expect(compiled.querySelector('app-settings-page h1')?.textContent).toContain('Settings');
  });

  it('should rebase the selected change onto trunk', async () => {
    const fixture = await createApp();

    await flushState({
      repoPath: '/tmp/repo',
      currentCommitId: 'abc',
      commits: [
        {
          commitId: 'abc',
          shortCommitId: 'abc',
          changeId: 'change',
          shortChangeId: 'change',
          description: 'current work',
          summary: 'current work',
          authorName: 'Ada',
          authorEmail: 'ada@example.com',
          authorTimestamp: '2026-06-17T12:00:00Z',
          current: true,
          empty: false,
          bookmarks: [],
        },
      ],
    });
    await flushDiff({ repoPath: '/tmp/repo', rev: '@' });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const rebaseButton = Array.from(compiled.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Rebase'),
    );
    expect(rebaseButton).toBeTruthy();
    rebaseButton?.click();

    const rebaseRequests = await waitForRequests('/api/changes/rebase');
    expect(rebaseRequests[0].request.method).toBe('POST');
    expect(rebaseRequests[0].request.body).toEqual({ rev: 'abc', repoPath: '/tmp/repo' });
    rebaseRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      command: ['jj', 'rebase', '-s', 'change', '-d', 'trunk()'],
      message: 'rebased',
      generatedAt: '2026-06-17T12:00:00Z',
    });

    await settle(fixture);
    await flushState({ repoPath: '/tmp/repo' });
    await flushDiff({ repoPath: '/tmp/repo', rev: 'change' });
    await settle(fixture);
  });

  it('should push a selected bookmark', async () => {
    const fixture = await createApp();

    await flushState({
      repoPath: '/tmp/repo',
      currentCommitId: 'abc',
      commits: [
        {
          commitId: 'abc',
          shortCommitId: 'abc',
          changeId: 'change',
          shortChangeId: 'change',
          description: 'current work',
          summary: 'current work',
          authorName: 'Ada',
          authorEmail: 'ada@example.com',
          authorTimestamp: '2026-06-17T12:00:00Z',
          current: true,
          empty: false,
          bookmarks: ['feature/ui'],
        },
      ],
      bookmarks: [
        {
          name: 'feature/ui',
          target: 'abc',
          shortTarget: 'abc',
          present: true,
          conflict: false,
          tracked: false,
          synced: false,
        },
      ],
    });
    await flushDiff({ repoPath: '/tmp/repo', rev: '@' });
    await settle(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    compiled.querySelector<HTMLButtonElement>('.bookmark-pill button')?.click();
    await settle(fixture);
    menuButton('Push')?.click();

    const pushRequests = await waitForRequests('/api/bookmarks/feature%2Fui/push');
    expect(pushRequests[0].request.method).toBe('POST');
    expect(pushRequests[0].request.body).toEqual({ repoPath: '/tmp/repo' });
    pushRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      command: ['jj', 'git', 'push', '-b', 'feature/ui'],
      message: 'pushed',
      generatedAt: '2026-06-17T12:00:00Z',
    });

    await settle(fixture);
    await flushState({ repoPath: '/tmp/repo' });
    await flushDiff({ repoPath: '/tmp/repo', rev: '@' });
    await settle(fixture);
  });

  it('should show evolution entries and switch the diff to the selected operation', async () => {
    const fixture = await createApp();

    const evolutionResponse = {
      repoPath: '/tmp/repo',
      rev: '@',
      entries: [
        evolutionEntry({
          commitId: 'historycommit',
          shortCommitId: 'historycomm',
          operationId: 'historyoperation',
          shortOperationId: 'historyoper',
          operationDescription: 'describe current work',
          filesChanged: 1,
          totalAdded: 3,
        }),
      ],
    };

    await flushState(
      {
        repoPath: '/tmp/repo',
        currentCommitId: 'abc',
        commits: [
          {
            commitId: 'abc',
            shortCommitId: 'abc',
            changeId: 'change',
            shortChangeId: 'change',
            description: 'current work',
            summary: 'current work',
            authorName: 'Ada',
            authorEmail: 'ada@example.com',
            authorTimestamp: '2026-06-17T12:00:00Z',
            current: true,
            empty: false,
            bookmarks: [],
          },
        ],
      },
      evolutionResponse,
    );
    await flushDiff({ repoPath: '/tmp/repo', rev: '@' }, evolutionResponse);
    await flushEvolutionIfPresent(evolutionResponse);
    await settle(fixture, evolutionResponse);

    const compiled = fixture.nativeElement as HTMLElement;
    clickTab(compiled, 'Evolution Log');
    await settle(fixture, evolutionResponse);
    expect(compiled.textContent).toContain('describe current work');
    const evolutionRow = compiled.querySelector<HTMLTableRowElement>('.evolution-table tbody tr');
    expect(evolutionRow).toBeTruthy();
    evolutionRow?.click();
    await settle(fixture, evolutionResponse);

    const evolutionDiffRequests = await waitForRequests('/api/evolution-diff');
    expect(queryParam(evolutionDiffRequests[0].request.urlWithParams, 'rev')).toBe('@');
    expect(queryParam(evolutionDiffRequests[0].request.urlWithParams, 'commitId')).toBe(
      'historycommit',
    );
    evolutionDiffRequests[0].flush({
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: 'historycommit',
      command: ['jj', 'evolog'],
      diff: [
        'diff --git a/file b/file',
        'index 0000000..1111111 100644',
        '--- a/file',
        '+++ b/file',
        '@@ -0,0 +1 @@',
        '+history line',
        '',
      ].join('\n'),
      files: [],
      generatedAt: '2026-06-17T12:00:00Z',
    });

    await settle(fixture);

    expect(compiled.textContent).toContain('history line');
  });

  async function createApp(config: Partial<RepositoryConfig> = {}) {
    const configStore = TestBed.inject(RepositoryConfigStore);
    const loadingConfig = configStore.load();
    http
      .expectOne((request) => request.method === 'GET' && request.url === '/api/config')
      .flush({
        currentRepository: '',
        repositories: [],
        logRevset: '',
        ...config,
      });
    await flushConfigWrites();
    await loadingConfig;

    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const targetPath = location.pathname === '/' ? '/revisions' : location.pathname;
    const navigation = router.navigateByUrl(`${targetPath}${location.search}${location.hash}`);
    fixture.detectChanges();
    await navigation;
    fixture.detectChanges();
    await flushHealthIfPresent();
    return fixture;
  }

  async function settle(
    fixture: ComponentFixture<App>,
    evolutionResponse: Partial<EvolutionLogResult> = {},
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await flushConfigWrites();
      await flushHealthIfPresent();
      await flushBookmarksIfPresent();
      await flushRemotesIfPresent();
      await flushWorkspacesIfPresent();
      await flushRepositoryFilesIfPresent();
      await flushEvolutionIfPresent(evolutionResponse);
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve));
    }
  }

  async function flushConfigWrites(): Promise<void> {
    let quietAttempts = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = activeRequests('/api/config', 'PUT');
      if (requests.length > 0) {
        for (const request of requests) {
          const value = request.request.body as RepositoryConfig;
          configWrites.push(value);
          request.flush(value);
        }
        quietAttempts = 0;
      } else {
        quietAttempts++;
      }

      if (quietAttempts >= 3) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve));
    }
  }

  async function flushState(
    response: StateFixture = {},
    evolutionResponse: Partial<EvolutionLogResult> = {},
  ): Promise<void> {
    const { bookmarks = [], workspaces = [], ...stateResponse } = response;
    const requests = await waitForRequests('/api/state');
    requests[0].flush({
      repoPath: '',
      vcs: 'jj',
      currentCommitId: '@',
      commits: [],
      graphRows: [],
      generatedAt: '2026-06-17T12:00:00Z',
      ...stateResponse,
    });

    await flushHealthIfPresent();
    await flushBookmarksIfPresent({ repoPath: stateResponse.repoPath ?? '', bookmarks });
    await flushRemotesIfPresent({ repoPath: stateResponse.repoPath ?? '' });
    await flushWorkspacesIfPresent({ repoPath: stateResponse.repoPath ?? '', workspaces });
    await flushEvolutionIfPresent(evolutionResponse);
  }

  async function flushStateIfPresent(
    response: StateFixture = {},
    evolutionResponse: Partial<EvolutionLogResult> = {},
  ): Promise<boolean> {
    const { bookmarks = [], workspaces = [], ...stateResponse } = response;
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = http.match(
        (req) => req.method === 'GET' && req.url.startsWith('/api/state'),
      );
      if (requests.length > 0) {
        for (const req of requests) {
          req.flush({
            repoPath: '',
            vcs: 'jj',
            currentCommitId: '@',
            commits: [],
            graphRows: [],
            generatedAt: '2026-06-17T12:00:00Z',
            ...stateResponse,
          });
        }
        await flushHealthIfPresent();
        await flushBookmarksIfPresent({ repoPath: stateResponse.repoPath ?? '', bookmarks });
        await flushRemotesIfPresent({ repoPath: stateResponse.repoPath ?? '' });
        await flushWorkspacesIfPresent({ repoPath: stateResponse.repoPath ?? '', workspaces });
        await flushEvolutionIfPresent(evolutionResponse);
        return true;
      }

      await Promise.resolve();
    }

    return false;
  }

  async function flushCommitIfPresent(response: Partial<CommitResult> = {}): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = activeRequests('/api/commit', 'GET');
      if (requests.length > 0) {
        for (const req of requests) {
          req.flush({
            repoPath: '',
            vcs: 'jj',
            rev: '@',
            commit: {
              commitId: 'abc',
              shortCommitId: 'abc',
              changeId: 'change',
              shortChangeId: 'change',
              description: 'selected work',
              summary: 'selected work',
              authorName: 'Ada',
              authorEmail: 'ada@example.com',
              authorTimestamp: '2026-06-17T12:00:00Z',
              current: false,
              empty: false,
              bookmarks: [],
            },
            generatedAt: '2026-06-17T12:00:00Z',
            ...response,
          });
        }
        return;
      }

      await Promise.resolve();
    }
  }

  async function flushDiff(
    response: Partial<DiffResult> = {},
    evolutionResponse: Partial<EvolutionLogResult> = {},
  ): Promise<void> {
    let flushed = false;
    let quietAttempts = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = activeRequests('/api/diff');
      for (const req of requests) {
        req.flush({
          repoPath: '',
          vcs: 'jj',
          rev: '@',
          command: [],
          diff: '',
          files: [],
          truncated: false,
          maxBytes: 4 * 1024 * 1024,
          generatedAt: '2026-06-17T12:00:00Z',
          ...response,
        });
        flushed = true;
      }

      if (requests.length === 0 && flushed) {
        quietAttempts++;
      } else {
        quietAttempts = 0;
      }

      if (flushed && quietAttempts >= 3) {
        await flushHealthIfPresent();
        await flushBookmarksIfPresent();
        await flushWorkspacesIfPresent();
        await flushEvolutionIfPresent(evolutionResponse);
        return;
      }

      await Promise.resolve();
    }

    if (!flushed) {
      const req = http.expectOne((request) => request.url.startsWith('/api/diff'));
      req.flush({
        repoPath: '',
        vcs: 'jj',
        rev: '@',
        command: [],
        diff: '',
        files: [],
        truncated: false,
        maxBytes: 4 * 1024 * 1024,
        generatedAt: '2026-06-17T12:00:00Z',
        ...response,
      });
    }
    await flushHealthIfPresent();
    await flushBookmarksIfPresent();
    await flushWorkspacesIfPresent();
    await flushEvolutionIfPresent(evolutionResponse);
  }

  async function flushDiffIfPresent(
    response: Partial<DiffResult> = {},
    evolutionResponse: Partial<EvolutionLogResult> = {},
  ): Promise<boolean> {
    let flushed = false;
    let quietAttempts = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = activeRequests('/api/diff', 'GET');
      if (requests.length > 0) {
        for (const req of requests) {
          req.flush({
            repoPath: '',
            vcs: 'jj',
            rev: '@',
            command: [],
            diff: '',
            files: [],
            truncated: false,
            maxBytes: 4 * 1024 * 1024,
            generatedAt: '2026-06-17T12:00:00Z',
            ...response,
          });
        }
        flushed = true;
        quietAttempts = 0;
      } else if (flushed) {
        quietAttempts++;
      }

      if (flushed && quietAttempts >= 3) {
        await flushHealthIfPresent();
        await flushEvolutionIfPresent(evolutionResponse);
        return true;
      }

      await Promise.resolve();
    }

    return false;
  }

  async function waitForRequests(urlPrefix: string) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = activeRequests(urlPrefix);
      if (requests.length > 0) {
        return requests;
      }

      await new Promise((resolve) => setTimeout(resolve));
    }

    return [http.expectOne((req) => req.url.startsWith(urlPrefix))];
  }

  async function waitForDiffRequest(rev: string, commitId: string): Promise<TestRequest> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const request = activeRequests('/api/diff').find(
        (candidate) =>
          queryParam(candidate.request.urlWithParams, 'rev') === rev &&
          queryParam(candidate.request.urlWithParams, 'commitId') === commitId,
      );
      if (request != null) {
        return request;
      }

      await new Promise((resolve) => setTimeout(resolve));
    }

    return http.expectOne(
      (request) =>
        request.url.startsWith('/api/diff') &&
        queryParam(request.urlWithParams, 'rev') === rev &&
        queryParam(request.urlWithParams, 'commitId') === commitId,
    );
  }

  function activeRequests(urlPrefix: string, method?: string) {
    return http
      .match((req) => req.url.startsWith(urlPrefix) && (method == null || req.method === method))
      .filter((req) => !req.cancelled);
  }

  async function flushEvolutionIfPresent(
    response: Partial<EvolutionLogResult> = {},
  ): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = activeRequests('/api/evolution-log');
      if (requests.length > 0) {
        for (const req of requests) {
          req.flush({
            repoPath: '',
            vcs: 'jj',
            rev: '@',
            entries: [],
            generatedAt: '2026-06-17T12:00:00Z',
            ...response,
          });
        }
        return;
      }

      await Promise.resolve();
    }
  }

  async function flushBookmarksIfPresent(response: Partial<BookmarksResult> = {}): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = http.match(
        (req) => req.method === 'GET' && req.url.startsWith('/api/bookmarks'),
      );
      if (requests.length > 0) {
        for (const req of requests) {
          req.flush({
            repoPath: '',
            vcs: 'jj',
            bookmarks: [],
            generatedAt: '2026-06-17T12:00:00Z',
            ...response,
          });
        }
        return;
      }

      await Promise.resolve();
    }
  }

  async function flushRemotesIfPresent(response: Partial<RemotesResult> = {}): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = http.match(
        (req) => req.method === 'GET' && req.url.startsWith('/api/remotes'),
      );
      if (requests.length > 0) {
        for (const req of requests) {
          req.flush({
            repoPath: '',
            vcs: 'jj',
            remotes: [{ name: 'origin', url: 'git@example.com:repo.git' }],
            generatedAt: '2026-06-17T12:00:00Z',
            ...response,
          });
        }
        return;
      }

      await Promise.resolve();
    }
  }

  async function flushWorkspacesIfPresent(response: Partial<WorkspacesResult> = {}): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = http.match(
        (req) => req.method === 'GET' && req.url.startsWith('/api/workspaces'),
      );
      if (requests.length > 0) {
        for (const req of requests) {
          req.flush({
            repoPath: '',
            vcs: 'jj',
            workspaces: [],
            generatedAt: '2026-06-17T12:00:00Z',
            ...response,
          });
        }
        return;
      }

      await Promise.resolve();
    }
  }

  async function flushOperationsIfPresent(
    response: Partial<OperationLogResult> = {},
  ): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = activeRequests('/api/operations', 'GET');
      if (requests.length > 0) {
        for (const req of requests) {
          req.flush({
            repoPath: '',
            vcs: 'jj',
            operations: [],
            limit: 50,
            hasMore: false,
            generatedAt: '2026-06-17T12:00:00Z',
            ...response,
          });
        }
        return;
      }

      await Promise.resolve();
    }
  }

  async function flushRepositoryFilesIfPresent(
    response: Partial<RepositoryFilesResult> = {},
  ): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = activeRequests('/api/repo/files', 'GET');
      if (requests.length > 0) {
        for (const req of requests) {
          req.flush({
            repoPath: '/tmp/repo',
            vcs: 'jj',
            rev: '1234567890abcdef',
            path: '',
            kind: 'directory',
            entries: [],
            generatedAt: '2026-08-03T12:00:00Z',
            ...response,
          } satisfies RepositoryFilesResult);
        }
        return;
      }

      await Promise.resolve();
    }
  }

  async function flushHealthIfPresent(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const requests = http.match((req) => req.url === '/api/health');
      if (requests.length > 0) {
        for (const req of requests) {
          req.flush({ status: 'ok' });
        }
        return;
      }

      await Promise.resolve();
    }
  }

  function queryParam(url: string, name: string): string | null {
    return new URL(url, 'http://localhost').searchParams.get(name);
  }

  function openRepoSelect(root: HTMLElement): void {
    const trigger = root.querySelector('.repo-select-field .mat-mdc-select-trigger') as HTMLElement;
    trigger.click();
  }

  function menuOption(label: string): HTMLElement | undefined {
    return Array.from(document.body.querySelectorAll<HTMLElement>('mat-option')).find((option) =>
      option.textContent?.includes(label),
    );
  }

  function menuOptionTexts(): string[] {
    return Array.from(document.body.querySelectorAll<HTMLElement>('mat-option')).map(
      (option) => option.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
  }

  function menuButton(label: string): HTMLButtonElement | undefined {
    return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes(label),
    );
  }

  function clickTab(root: HTMLElement, label: string): void {
    const target = Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]')).find((button) =>
      button.textContent?.includes(label),
    );
    if (target == null) {
      throw new Error(`Tab not found: ${label}`);
    }

    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    target.click();
  }

  function evolutionEntry(overrides: Partial<EvolutionEntry> = {}): EvolutionEntry {
    return {
      commitId: 'abc',
      shortCommitId: 'abc',
      changeId: 'change',
      shortChangeId: 'change',
      description: 'current work',
      summary: 'current work',
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      authorTimestamp: '2026-06-17T12:00:00Z',
      operationId: 'op',
      shortOperationId: 'op',
      operationDescription: 'snapshot working copy',
      operationUser: 'ada',
      operationTimestamp: '2026-06-17T12:00:00Z',
      predecessors: [],
      shortPredecessors: [],
      filesChanged: 0,
      totalAdded: 0,
      totalRemoved: 0,
      ...overrides,
    };
  }

  function revisionCommit(
    commitId: string,
    changeId: string,
    overrides: Partial<Commit> = {},
  ): Commit {
    return {
      shortCommitId: commitId.slice(0, 12),
      shortChangeId: changeId.slice(0, 12),
      description: commitId,
      summary: commitId,
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      authorTimestamp: '2026-06-17T12:00:00Z',
      current: false,
      empty: false,
      bookmarks: [],
      ...overrides,
      commitId,
      changeId,
    };
  }

  function emptyDiff(rev: string): DiffResult {
    return {
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev,
      command: [],
      diff: '',
      files: [],
      truncated: false,
      maxBytes: 4 * 1024 * 1024,
      generatedAt: '2026-06-17T12:00:00Z',
    };
  }

  function operationEntry(overrides: Partial<OperationFixture> = {}): OperationFixture {
    return {
      id: 'abc',
      shortId: 'abc',
      parents: [],
      shortParents: [],
      description: 'snapshot working copy',
      user: 'ada@example.com',
      timestamp: '2026-06-17T12:00:00Z',
      current: false,
      snapshot: false,
      workspaceName: 'default@',
      root: false,
      attributes: '',
      ...overrides,
    };
  }
});
