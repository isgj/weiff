import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { Bookmark, Commit, EvolutionEntry } from '../../data/repo-api';

import { CommitDetail } from './commit-detail';

const commit: Commit = {
  commitId: 'abc123456789',
  shortCommitId: 'abc123456789',
  changeId: 'change1234567',
  shortChangeId: 'change1234567',
  description: 'feat: add watch command\n\nBody text',
  summary: 'feat: add watch command',
  authorName: 'Ada',
  authorEmail: 'ada@example.com',
  authorTimestamp: '2026-06-17T12:00:00Z',
  current: false,
  empty: false,
  bookmarks: [],
  tags: [],
};

describe('CommitDetail', () => {
  let component: CommitDetail;
  let fixture: ComponentFixture<CommitDetail>;
  let dialogResult: unknown;

  beforeEach(async () => {
    dialogResult = undefined;
    await TestBed.configureTestingModule({
      imports: [CommitDetail],
      providers: [
        {
          provide: MatDialog,
          useValue: {
            open: () => ({ afterClosed: () => of(dialogResult) }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitDetail);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should open the commit details by default and collapse on click', async () => {
    fixture.componentRef.setInput('commit', commit);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const panel = root.querySelector<HTMLElement>('.commit-card');
    const header = root.querySelector<HTMLElement>('.commit-card-header');

    expect(panel?.classList.contains('mat-expanded')).toBe(true);
    expect(header?.getAttribute('aria-expanded')).toBe('true');

    header?.click();
    await fixture.whenStable();

    expect(panel?.classList.contains('mat-expanded')).toBe(false);
    expect(header?.getAttribute('aria-expanded')).toBe('false');
  });

  it('should render only the commit message body as Markdown in the expanded details', async () => {
    fixture.componentRef.setInput('commit', {
      ...commit,
      description: 'feat: add watch command\n\nDetails:\n\n- Body text\n- `code`',
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;

    const messageSurface = root.querySelector<HTMLElement>('.message-surface');
    expect(messageSurface?.textContent).toContain('Details:');
    expect(messageSurface?.textContent).toContain('Body text');
    expect(messageSurface?.textContent).not.toContain('feat: add watch command');
    expect(messageSurface?.querySelectorAll('li').length).toBe(2);
    expect(messageSurface?.querySelector('code')?.textContent).toBe('code');
    expect(root.querySelector('.commit-details')?.classList.contains('has-message-body')).toBe(
      true,
    );
  });

  it('should hide the commit message body section when there is no body', async () => {
    fixture.componentRef.setInput('commit', {
      ...commit,
      description: 'feat: add watch command',
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.message-surface')).toBeNull();
    expect(root.querySelector('.commit-details')?.classList.contains('has-message-body')).toBe(
      false,
    );
  });

  it('should show only the change and commit ids', async () => {
    fixture.componentRef.setInput('commit', commit);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const idChips = root.querySelectorAll<HTMLElement>('.id-chip');
    expect(idChips.length).toBe(2);
    expect(idChips[0].textContent).toContain(commit.shortChangeId);
    expect(idChips[1].textContent).toContain(commit.shortCommitId);
  });

  it('should show divergent change state when the selected commit is divergent', async () => {
    fixture.componentRef.setInput('commit', {
      ...commit,
      divergent: true,
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const divergentPill = root.querySelector<HTMLElement>('.divergent-pill');
    expect(divergentPill?.textContent).toContain('Divergent');
    expect(divergentPill?.getAttribute('title')).toContain(
      'Divergent change: multiple visible commits',
    );
  });

  it('should show one selected bookmark when local and tracked bookmarks share a name', async () => {
    const selectedCommit = { ...commit, bookmarks: ['nebius'] };
    const bookmarks: Bookmark[] = [
      {
        name: 'nebius',
        target: selectedCommit.commitId,
        shortTarget: selectedCommit.shortCommitId,
        present: true,
        conflict: false,
        tracked: false,
        synced: false,
      },
      {
        name: 'nebius',
        remote: 'origin',
        target: 'remote123456',
        shortTarget: 'remote123456',
        present: true,
        conflict: false,
        tracked: true,
        synced: false,
      },
    ];

    fixture.componentRef.setInput('commit', selectedCommit);
    fixture.componentRef.setInput('bookmarks', bookmarks);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const bookmarkPills = root.querySelectorAll<HTMLElement>('.bookmark-pill');

    expect(bookmarkPills.length).toBe(1);
    expect(bookmarkPills[0].textContent).toContain('nebius');
    expect(bookmarkPills[0].getAttribute('title')).toContain(`Target: ${selectedCommit.commitId}`);
  });

  it('should show revision tags below bookmarks without actions', async () => {
    fixture.componentRef.setInput('commit', {
      ...commit,
      tags: ['v1.0.0', 'release'],
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const bookmarksSection = root.querySelector<HTMLElement>(
      '[aria-label="Selected commit bookmarks"]',
    );
    const tagsSection = root.querySelector<HTMLElement>('[aria-label="Selected commit tags"]');
    const tagChips = tagsSection?.querySelectorAll<HTMLElement>('mat-chip');

    expect(bookmarksSection).not.toBeNull();
    expect(tagsSection).not.toBeNull();
    expect(
      bookmarksSection!.compareDocumentPosition(tagsSection!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(tagChips?.length).toBe(2);
    expect(tagChips?.[0].textContent).toContain('v1.0.0');
    expect(tagChips?.[1].textContent).toContain('release');
    expect(tagChips?.[0].querySelector('mat-icon')?.textContent).toContain('sell');
    expect(tagsSection?.querySelector('button')).toBeNull();
  });

  it('should show push instead of update in the bookmark menu', async () => {
    const pushed: string[] = [];
    component.bookmarkPushed.subscribe((name) => pushed.push(name));
    const selectedCommit = { ...commit, bookmarks: ['nebius'] };
    fixture.componentRef.setInput('commit', selectedCommit);
    fixture.componentRef.setInput('bookmarks', [
      {
        name: 'nebius',
        target: selectedCommit.commitId,
        shortTarget: selectedCommit.shortCommitId,
        present: true,
        conflict: false,
        tracked: false,
        synced: false,
      },
    ] satisfies Bookmark[]);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('.bookmark-pill button')?.click();
    await fixture.whenStable();

    expect(document.body.textContent).toContain('Push');
    expect(document.body.textContent).not.toContain('Update here');
    menuItem('Push')?.click();
    await fixture.whenStable();

    expect(pushed).toEqual(['nebius']);
  });

  it('should show evolution entries and emit the selected entry', async () => {
    const selectedEntries: EvolutionEntry[] = [];
    const entry = evolutionEntry({ commitId: 'historycommit', shortCommitId: 'historycomm' });
    component.evolutionSelected.subscribe((selected) => selectedEntries.push(selected));
    fixture.componentRef.setInput('commit', commit);
    fixture.componentRef.setInput('evolutionLog', {
      repoPath: '/tmp/repo',
      vcs: 'jj',
      rev: commit.changeId,
      entries: [entry],
      generatedAt: '2026-06-22T12:00:00Z',
    });
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    clickTab(root, 'Evolution Log');
    await fixture.whenStable();

    expect(root.textContent).toContain('snapshot working copy');
    expect(root.textContent).toContain('historycomm');
    root.querySelector<HTMLTableRowElement>('.evolution-table tr[mat-row]')?.click();
    await fixture.whenStable();

    expect(selectedEntries).toEqual([entry]);
  });

  it('should emit commit ids for commit actions', async () => {
    const emitted: string[] = [];
    component.checkoutRequested.subscribe((rev) => emitted.push(`checkout:${rev}`));
    component.newFromRequested.subscribe((rev) => emitted.push(`new:${rev}`));
    component.rebaseRequested.subscribe((rev) => emitted.push(`rebase:${rev}`));
    component.abandonRequested.subscribe((rev) => emitted.push(`abandon:${rev}`));

    fixture.componentRef.setInput('commit', commit);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    dialogResult = true;
    button(root, 'Checkout')?.click();
    button(root, 'New Commit')?.click();
    button(root, 'Rebase')?.click();
    button(root, 'Abandon')?.click();
    await fixture.whenStable();

    expect(emitted).toEqual([
      `checkout:${commit.commitId}`,
      `new:${commit.commitId}`,
      `rebase:${commit.commitId}`,
      `abandon:${commit.commitId}`,
    ]);
  });
});

function button(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
    candidate.textContent?.includes(label),
  );
}

function menuItem(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
    candidate.textContent?.includes(label),
  );
}

function clickTab(root: HTMLElement, label: string): void {
  const target = Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]')).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (target == null) {
    throw new Error(`Tab not found: ${label}`);
  }

  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function evolutionEntry(overrides: Partial<EvolutionEntry> = {}): EvolutionEntry {
  return {
    commitId: 'abc123456789',
    shortCommitId: 'abc123456789',
    changeId: 'change1234567',
    shortChangeId: 'change1234567',
    description: 'feat: add watch command',
    summary: 'feat: add watch command',
    authorName: 'Ada',
    authorEmail: 'ada@example.com',
    authorTimestamp: '2026-06-17T12:00:00Z',
    operationId: 'op123456789',
    shortOperationId: 'op123456789',
    operationDescription: 'snapshot working copy',
    operationUser: 'ada',
    operationTimestamp: '2026-06-17T12:00:00Z',
    predecessors: ['prev123456789'],
    shortPredecessors: ['prev1234567'],
    filesChanged: 2,
    totalAdded: 4,
    totalRemoved: 1,
    ...overrides,
  };
}
