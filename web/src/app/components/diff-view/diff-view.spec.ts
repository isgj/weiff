import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DiffView } from './diff-view';

describe('DiffView', () => {
  let component: DiffView;
  let fixture: ComponentFixture<DiffView>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiffView],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(DiffView);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should keep file diffs closed by default and open only the selected file', async () => {
    fixture.componentRef.setInput('diff', {
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: 'abc',
      command: ['jj', 'diff'],
      diff: '',
      generatedAt: '2026-06-19T12:00:00Z',
      files: [
        {
          path: 'first.txt',
          status: 'modified',
          statusChar: 'M',
          conflict: false,
          lines: [{ kind: 'added', content: '+first' }],
        },
        {
          path: 'second.txt',
          status: 'modified',
          statusChar: 'M',
          conflict: false,
          lines: [{ kind: 'added', content: '+second' }],
        },
      ],
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.file-panel.mat-expanded').length).toBe(0);

    root.querySelector<HTMLElement>('.file-panel mat-expansion-panel-header')?.click();
    await fixture.whenStable();

    expect(root.querySelectorAll('.file-panel.mat-expanded').length).toBe(1);
  });

  it('should mark conflicted files in the file list', async () => {
    fixture.componentRef.setInput('diff', {
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: 'abc',
      command: ['jj', 'diff'],
      diff: '',
      generatedAt: '2026-06-19T12:00:00Z',
      files: [
        {
          path: 'conflicted.go',
          status: 'modified',
          statusChar: 'M',
          conflict: true,
          lines: [{ kind: 'added', content: '+first' }],
        },
      ],
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const conflictChip = root.querySelector<HTMLElement>('.conflict-chip');

    expect(conflictChip?.textContent).toContain('Conflict');
    expect(conflictChip?.getAttribute('title')).toContain('unresolved conflicts');
  });

  it('should render split output when split mode is selected', async () => {
    fixture.componentRef.setInput('mode', 'split');
    fixture.componentRef.setInput('diff', {
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: 'abc',
      command: ['jj', 'diff'],
      diff: '',
      generatedAt: '2026-06-19T12:00:00Z',
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
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLElement>('.file-panel mat-expansion-panel-header')?.click();
    await fixture.whenStable();

    expect(root.querySelector('.split-output')).toBeTruthy();
    expect(root.querySelector('.diff-output')).toBeFalsy();
  });

  it('should parse raw git patches without rendering patch metadata', async () => {
    fixture.componentRef.setInput('diff', {
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: 'abc',
      command: ['jj', 'diff', '--git'],
      diff: [
        'diff --git a/src/file.ts b/src/file.ts',
        'index d7d01726d9..4eb095a908 100644',
        '--- a/src/file.ts',
        '+++ b/src/file.ts',
        '@@ -1,1 +1,1 @@',
        '-const oldValue = false;',
        '+const newValue = true;',
      ].join('\n'),
      generatedAt: '2026-06-19T12:00:00Z',
      files: [
        {
          path: 'src/file.ts',
          status: 'modified',
          statusChar: 'M',
          conflict: false,
          lines: [],
        },
      ],
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLElement>('.file-panel mat-expansion-panel-header')?.click();
    await fixture.whenStable();

    const output = root.querySelector<HTMLElement>('.diff-output');
    const outputText = output?.textContent ?? '';

    expect(outputText).toContain('@@ -1,1 +1,1 @@');
    expect(outputText).toContain('const newValue = true;');
    expect(outputText).not.toContain('diff --git');
    expect(outputText).not.toContain('index d7d01726d9');
    expect(outputText).not.toContain('--- a/src/file.ts');
    expect(outputText).not.toContain('+++ b/src/file.ts');
    expect(output?.getAttribute('aria-label')).toBe('Inline diff for src/file.ts');
    expect(output?.getAttribute('tabindex')).toBe('0');
    expect(output?.querySelector('.hljs-keyword')?.textContent).toBe('const');
  });

  it('should highlight files whose language is identified by filename', async () => {
    fixture.componentRef.setInput('diff', {
      ...rawPatchDiff(),
      diff: [
        'diff --git a/Dockerfile b/Dockerfile',
        '--- a/Dockerfile',
        '+++ b/Dockerfile',
        '@@ -0,0 +1,1 @@',
        '+FROM node:22',
      ].join('\n'),
      files: [
        {
          path: 'Dockerfile',
          status: 'modified',
          statusChar: 'M',
          conflict: false,
          lines: [],
        },
      ],
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLElement>('.file-panel mat-expansion-panel-header')?.click();
    await fixture.whenStable();

    expect(root.querySelector('.diff-output .hljs-keyword')?.textContent).toBe('FROM');
  });

  it('should render rename-only patches alongside files with textual hunks', async () => {
    const renamedPath = 'codastre/public-serverless/actions/serverless-images.yaml';
    fixture.componentRef.setInput('diff', {
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: '@',
      command: ['jj', 'diff', '--git'],
      diff: [
        `diff --git a/codastre/msp/actions/serverless-images.yaml b/${renamedPath}`,
        'rename from codastre/msp/actions/serverless-images.yaml',
        `rename to ${renamedPath}`,
        'diff --git a/codastre/public-serverless/envs.yaml b/codastre/public-serverless/envs.yaml',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/codastre/public-serverless/envs.yaml',
        '@@ -0,0 +1,1 @@',
        '+nemax-prod: {}',
        'diff --git a/codastre/public-serverless/project.yaml b/codastre/public-serverless/project.yaml',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/codastre/public-serverless/project.yaml',
        '@@ -0,0 +1,1 @@',
        '+description: Serverless images',
      ].join('\n'),
      generatedAt: '2026-07-17T07:28:50Z',
      files: [
        {
          path: renamedPath,
          status: '',
          statusChar: '',
          conflict: false,
          lines: [
            {
              kind: 'header',
              content: `diff --git a/codastre/msp/actions/serverless-images.yaml b/${renamedPath}`,
            },
            {
              kind: 'context',
              content: 'rename from codastre/msp/actions/serverless-images.yaml',
            },
            { kind: 'context', content: `rename to ${renamedPath}` },
          ],
        },
        {
          path: 'codastre/public-serverless/envs.yaml',
          status: 'added',
          statusChar: 'A',
          conflict: false,
          lines: [],
        },
        {
          path: 'codastre/public-serverless/project.yaml',
          status: 'added',
          statusChar: 'A',
          conflict: false,
          lines: [],
        },
      ],
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const panels = [...root.querySelectorAll<HTMLElement>('.file-panel')];

    expect(panels.length).toBe(3);
    expect(panels[0].textContent).toContain(renamedPath);
    expect(panels[0].textContent).toContain('renamed');
    expect(panels[0].querySelector('.status-badge')?.getAttribute('title')).toBe('renamed');
    expect(panels[0].querySelector('mat-icon')?.textContent?.trim()).toBe(
      'drive_file_rename_outline',
    );
  });

  it('should use an icon for the file status marker', async () => {
    fixture.componentRef.setInput('diff', {
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: 'abc',
      command: ['jj', 'diff'],
      diff: '',
      generatedAt: '2026-06-19T12:00:00Z',
      files: [
        {
          path: 'added.go',
          status: 'added',
          statusChar: 'A',
          conflict: false,
          lines: [{ kind: 'added', content: '+package main' }],
        },
      ],
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const statusIcon = root.querySelector<HTMLElement>('.status-badge mat-icon');

    expect(statusIcon?.textContent?.trim()).toBe('add_circle');
    expect(root.querySelector<HTMLElement>('.status-badge')?.getAttribute('title')).toBe('added');
  });

  it('should hide restore buttons when the diff is not restorable', async () => {
    fixture.componentRef.setInput('diff', rawPatchDiff());
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLElement>('.file-panel mat-expansion-panel-header')?.click();
    await fixture.whenStable();

    expect(root.querySelector('.restore-file-button')).toBeFalsy();
    expect(root.querySelector('.restore-hunk-button')).toBeFalsy();
  });

  it('should emit a file restore request without toggling the panel', async () => {
    fixture.componentRef.setInput('restorable', true);
    fixture.componentRef.setInput('diff', rawPatchDiff());
    await fixture.whenStable();

    const restored: string[] = [];
    component.restoreFileRequested.subscribe((path) => restored.push(path));

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLElement>('.restore-file-button')?.click();
    await fixture.whenStable();

    expect(restored).toEqual(['src/file.ts']);
    expect(root.querySelectorAll('.file-panel.mat-expanded').length).toBe(0);
  });

  it('should emit a hunk restore request with the hunk patch lines', async () => {
    fixture.componentRef.setInput('restorable', true);
    fixture.componentRef.setInput('diff', rawPatchDiff());
    await fixture.whenStable();

    const restored: unknown[] = [];
    component.restoreHunkRequested.subscribe((hunk) => restored.push(hunk));

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLElement>('.file-panel mat-expansion-panel-header')?.click();
    await fixture.whenStable();

    root.querySelector<HTMLElement>('.restore-hunk-button')?.click();
    await fixture.whenStable();

    expect(restored).toEqual([
      {
        path: 'src/file.ts',
        newStart: 1,
        lines: ['-const oldValue = false;', '+const newValue = true;'],
      },
    ]);
  });

  it('should filter the file list by path', async () => {
    fixture.componentRef.setInput('diff', twoFileDiff());
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.file-panel').length).toBe(2);

    const filterInput = root.querySelector<HTMLInputElement>('.file-filter-field input');
    filterInput!.value = 'second';
    filterInput!.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const panels = root.querySelectorAll('.file-panel');
    expect(panels.length).toBe(1);
    expect(panels[0].textContent).toContain('second.txt');
  });

  it('should show an empty state when no files match the filter', async () => {
    fixture.componentRef.setInput('diff', twoFileDiff());
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const filterInput = root.querySelector<HTMLInputElement>('.file-filter-field input');
    filterInput!.value = 'nomatch';
    filterInput!.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(root.querySelectorAll('.file-panel').length).toBe(0);
    expect(root.querySelector('.filter-empty')?.textContent).toContain('No files match');

    root.querySelector<HTMLElement>('.filter-empty button')?.click();
    await fixture.whenStable();

    expect(root.querySelectorAll('.file-panel').length).toBe(2);
  });

  it('should only keep one file expanded at a time', async () => {
    fixture.componentRef.setInput('diff', twoFileDiff());
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const headers = root.querySelectorAll<HTMLElement>('.file-panel mat-expansion-panel-header');

    headers[0]?.click();
    await fixture.whenStable();
    expect(root.querySelectorAll('.file-panel.mat-expanded').length).toBe(1);

    headers[1]?.click();
    await fixture.whenStable();

    const expanded = [...root.querySelectorAll<HTMLElement>('.file-panel.mat-expanded')];
    expect(expanded.length).toBe(1);
    expect(expanded[0].textContent).toContain('second.txt');
  });

  it('should emit a mode change from the toolbar toggle', async () => {
    fixture.componentRef.setInput('diff', twoFileDiff());
    await fixture.whenStable();

    const modes: string[] = [];
    component.modeChanged.subscribe((mode) => modes.push(mode));

    const root = fixture.nativeElement as HTMLElement;
    root
      .querySelector<HTMLElement>('.diff-mode-toggle mat-button-toggle[value="split"] button')
      ?.click();
    await fixture.whenStable();

    expect(modes).toEqual(['split']);
  });

  it('should render a copy path button for each file', async () => {
    fixture.componentRef.setInput('diff', twoFileDiff());
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const copyButtons = root.querySelectorAll<HTMLElement>('.copy-path-button');

    expect(copyButtons.length).toBe(2);
    expect(copyButtons[0].getAttribute('aria-label')).toBe('Copy path first.txt');
  });

  it('should not offer hunk restore for backend-rendered diffs without patch data', async () => {
    fixture.componentRef.setInput('restorable', true);
    fixture.componentRef.setInput('diff', {
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: 'abc',
      command: ['jj', 'diff'],
      diff: '',
      generatedAt: '2026-06-19T12:00:00Z',
      files: [
        {
          path: 'file.txt',
          status: 'modified',
          statusChar: 'M',
          conflict: false,
          lines: [{ kind: 'added', content: '+new' }],
        },
      ],
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLElement>('.file-panel mat-expansion-panel-header')?.click();
    await fixture.whenStable();

    expect(root.querySelector('.restore-file-button')).toBeTruthy();
    expect(root.querySelector('.restore-hunk-button')).toBeFalsy();
  });

  it('should highlight changed words within paired removed and added lines', async () => {
    fixture.componentRef.setInput('diff', rawPatchDiff());
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLElement>('.file-panel mat-expansion-panel-header')?.click();
    await fixture.whenStable();

    const removedWords = [...root.querySelectorAll<HTMLElement>('.diff-word-removed')];
    const addedWords = [...root.querySelectorAll<HTMLElement>('.diff-word-added')];

    expect(removedWords.map((el) => el.textContent).join('')).toContain('oldValue');
    expect(removedWords.map((el) => el.textContent).join('')).toContain('false');
    expect(addedWords.map((el) => el.textContent).join('')).toContain('newValue');
    expect(addedWords.map((el) => el.textContent).join('')).toContain('true');
    // Syntax highlighting must survive the word-diff overlay.
    expect(root.querySelector('.diff-output .hljs-keyword')?.textContent).toBe('const');
  });

  it('should not word-highlight when the whole line changed', async () => {
    fixture.componentRef.setInput('diff', {
      ...rawPatchDiff(),
      diff: [
        'diff --git a/src/file.ts b/src/file.ts',
        '--- a/src/file.ts',
        '+++ b/src/file.ts',
        '@@ -1,1 +1,1 @@',
        '-completely different content here',
        '+nothing at all in common xyz',
      ].join('\n'),
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLElement>('.file-panel mat-expansion-panel-header')?.click();
    await fixture.whenStable();

    expect(root.querySelectorAll('.diff-word-removed').length).toBe(0);
    expect(root.querySelectorAll('.diff-word-added').length).toBe(0);
  });

  it('should emit ignore-whitespace toggle changes from the toolbar', async () => {
    fixture.componentRef.setInput('diff', twoFileDiff());
    await fixture.whenStable();

    const changes: boolean[] = [];
    component.ignoreWhitespaceChanged.subscribe((value) => changes.push(value));

    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector<HTMLElement>('.whitespace-toggle-button');
    expect(button?.getAttribute('aria-pressed')).toBe('false');

    button?.click();
    await fixture.whenStable();

    expect(changes).toEqual([true]);

    fixture.componentRef.setInput('ignoreWhitespace', true);
    await fixture.whenStable();
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });

  it('should expand hidden context between hunks with file content', async () => {
    fixture.componentRef.setInput('diff', {
      ...rawPatchDiff(),
      diff: [
        'diff --git a/src/file.ts b/src/file.ts',
        '--- a/src/file.ts',
        '+++ b/src/file.ts',
        '@@ -5,1 +5,1 @@',
        '-old line five',
        '+new line five',
      ].join('\n'),
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLElement>('.file-panel mat-expansion-panel-header')?.click();
    await fixture.whenStable();

    const expanders = [...root.querySelectorAll<HTMLElement>('.gap-expander')];
    expect(expanders.length).toBe(2);
    expect(expanders[0].textContent).toContain('Expand 4 hidden lines');
    expect(expanders[1].textContent).toContain('Expand remaining lines');

    expanders[0].click();
    const req = httpMock.expectOne(
      (r) => r.url.startsWith('/api/file-content') && r.url.includes('path=src%2Ffile.ts'),
    );
    req.flush({
      repoPath: '/tmp/repo',
      rev: 'abc',
      path: 'src/file.ts',
      content: 'line one\nline two\nline three\nline four\nnew line five\nline six\n',
      generatedAt: '2026-06-19T12:00:00Z',
    });
    await fixture.whenStable();

    const outputText = root.querySelector('.diff-output')?.textContent ?? '';
    expect(outputText).toContain('line one');
    expect(outputText).toContain('line four');
    expect(root.querySelectorAll('.gap-expander').length).toBe(1);
  });

  it('should not offer context expansion for created files', async () => {
    fixture.componentRef.setInput('diff', {
      ...rawPatchDiff(),
      diff: [
        'diff --git a/brand-new.ts b/brand-new.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/brand-new.ts',
        '@@ -0,0 +1,1 @@',
        '+hello',
      ].join('\n'),
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLElement>('.file-panel mat-expansion-panel-header')?.click();
    await fixture.whenStable();

    expect(root.querySelectorAll('.gap-expander').length).toBe(0);
  });
});

function twoFileDiff() {
  return {
    repoPath: '/tmp/repo',
    vcs: 'jj',
    rev: 'abc',
    command: ['jj', 'diff'],
    diff: '',
    generatedAt: '2026-06-19T12:00:00Z',
    files: [
      {
        path: 'first.txt',
        status: 'modified',
        statusChar: 'M',
        conflict: false,
        lines: [{ kind: 'added', content: '+first' }],
      },
      {
        path: 'second.txt',
        status: 'modified',
        statusChar: 'M',
        conflict: false,
        lines: [{ kind: 'added', content: '+second' }],
      },
    ],
  };
}

function rawPatchDiff() {
  return {
    repoPath: '/tmp/repo',
    vcs: 'jj',
    rev: 'abc',
    command: ['jj', 'diff', '--git'],
    diff: [
      'diff --git a/src/file.ts b/src/file.ts',
      'index d7d01726d9..4eb095a908 100644',
      '--- a/src/file.ts',
      '+++ b/src/file.ts',
      '@@ -1,1 +1,1 @@',
      '-const oldValue = false;',
      '+const newValue = true;',
    ].join('\n'),
    generatedAt: '2026-06-19T12:00:00Z',
    files: [
      {
        path: 'src/file.ts',
        status: 'modified',
        statusChar: 'M',
        conflict: false,
        lines: [],
      },
    ],
  };
}
