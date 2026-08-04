import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { RepositoryFilesResult } from '../../data/repo-api';
import { RevisionDashboardState } from '../../data/revision-dashboard-state';
import { FilesPage } from './files-page';

describe('FilesPage', () => {
  let fixture: ComponentFixture<FilesPage>;
  const repositoryFilePath = signal('');
  const repositoryFiles = signal<RepositoryFilesResult | null>(null);
  const selectedRev = signal('@');
  const loading = signal(false);
  const error = signal<string | null>(null);
  const refresh = vi.fn();

  beforeEach(async () => {
    repositoryFilePath.set('');
    repositoryFiles.set(null);
    selectedRev.set('@');
    loading.set(false);
    error.set(null);
    refresh.mockClear();

    await TestBed.configureTestingModule({
      imports: [FilesPage],
      providers: [
        provideRouter([]),
        {
          provide: RevisionDashboardState,
          useValue: {
            repositoryFilePath,
            repositoryFiles,
            repositoryFilesResource: {
              isLoading: loading,
              hasValue: () => repositoryFiles() != null,
            },
            error,
            effectiveRepoPath: signal('/tmp/repo'),
            selectedRepoLabel: signal('repo'),
            selectedRev,
            refresh,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FilesPage);
  });

  it('renders breadcrumbs and immediate directory entries', async () => {
    repositoryFilePath.set('web/src');
    repositoryFiles.set(
      result({
        path: 'web/src',
        kind: 'directory',
        entries: [
          { name: 'app', path: 'web/src/app', kind: 'directory' },
          { name: 'main.ts', path: 'web/src/main.ts', kind: 'file' },
        ],
      }),
    );

    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.breadcrumbs')?.textContent).toContain('repo');
    expect(root.querySelector('.breadcrumbs')?.textContent).toContain('web');
    expect(root.querySelector('.breadcrumbs')?.textContent).toContain('src');
    expect(root.querySelectorAll('.file-entry')).toHaveLength(2);
    expect(root.querySelector('.file-list')?.textContent).toContain('app');
    expect(root.querySelector('.file-list')?.textContent).toContain('main.ts');
  });

  it('renders syntax-highlighted file content', async () => {
    repositoryFilePath.set('src/main.go');
    repositoryFiles.set(
      result({
        path: 'src/main.go',
        kind: 'file',
        content: 'package main\n\nfunc main() {}\n',
      }),
    );

    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.file-heading h2')?.textContent).toContain('main.go');
    expect(root.querySelector('.syntax-code .hljs-keyword')?.textContent).toBe('package');
    expect(root.querySelector('.file-content')?.textContent).toContain('func main');
    expect(root.querySelector('.line-number-gutter')?.textContent).toBe('1\n2\n3');

    repositoryFiles.set(result({ path: 'empty.txt', kind: 'file', content: '' }));
    await fixture.whenStable();
    expect(root.querySelector('.line-number-gutter')?.textContent).toBe('1');
  });

  it('identifies files opened from a historical revision', async () => {
    selectedRev.set('feature-change');
    repositoryFiles.set(result());

    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.page-header p')?.textContent).toContain('Files at revision');
    expect(root.querySelector('.page-header code')?.getAttribute('title')).toBe('feature-change');
  });

  it('shows binary and error states without rendering content', async () => {
    repositoryFilePath.set('assets/image.bin');
    repositoryFiles.set(result({ path: 'assets/image.bin', kind: 'file', binary: true }));
    await fixture.whenStable();

    let root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Binary files cannot be previewed');
    expect(root.querySelector('.file-content')).toBeNull();

    error.set('path not found');
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('path not found');

    root.querySelector<HTMLButtonElement>('button')?.click();
    expect(refresh).toHaveBeenCalledOnce();
  });
});

function result(overrides: Partial<RepositoryFilesResult> = {}): RepositoryFilesResult {
  return {
    repoPath: '/tmp/repo',
    vcs: 'jj',
    rev: '1234567890abcdef',
    path: '',
    kind: 'directory',
    entries: [],
    generatedAt: '2026-08-03T12:00:00Z',
    ...overrides,
  };
}
