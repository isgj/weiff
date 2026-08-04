import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Commit } from '../../data/repo-api';

import { CommitGraph } from './commit-graph';

describe('CommitGraph', () => {
  let component: CommitGraph;
  let fixture: ComponentFixture<CommitGraph>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommitGraph],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitGraph);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render jj graph rows without bookmark chips or side state markers', async () => {
    fixture.componentRef.setInput('currentCommitId', 'merge');
    fixture.componentRef.setInput('selectedCommitId', 'merge');
    fixture.componentRef.setInput('commits', [
      commit({
        commitId: 'merge',
        changeId: 'zchange000000',
        shortChangeId: 'zchange0000',
        current: true,
        bookmarks: ['users/isgjevori/very-long-bookmark-name'],
      }),
      commit({ commitId: 'left' }),
      commit({ commitId: 'right', empty: true }),
      commit({ commitId: 'base' }),
    ]);
    fixture.componentRef.setInput('graphRows', [
      { commitId: 'merge', graph: '@' },
      { graph: '├─╮' },
      { commitId: 'left', graph: '│ ○' },
      { commitId: 'right', graph: '◆ │' },
      { graph: '├─╯' },
      { commitId: 'base', graph: '○' },
    ]);

    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const list = root.querySelector('mat-nav-list');
    const firstGroup = root.querySelector<HTMLElement>('.change-group');
    expect(list?.getAttribute('role')).toBe('listbox');
    expect(root.querySelectorAll('mat-list-item').length).toBe(4);
    expect(root.querySelectorAll('.node-row').length).toBe(4);
    expect(root.querySelectorAll('.connector-row').length).toBe(2);
    expect(root.querySelectorAll('.change-group').length).toBe(4);
    expect(firstGroup?.getAttribute('role')).toBe('option');
    expect(firstGroup?.getAttribute('aria-selected')).toBe('true');
    expect(firstGroup?.classList.contains('mdc-list-item--activated')).toBe(true);
    expect(root.querySelectorAll('svg.graph-svg').length).toBeGreaterThan(4);
    expect(root.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(root.querySelector('rect')).toBeNull();
    expect(firstGroup?.getAttribute('title')).toContain('Commit: merge');
    expect(firstGroup?.getAttribute('title')).not.toContain(
      'users/isgjevori/very-long-bookmark-name',
    );
    const firstMeta = root.querySelector<HTMLElement>('.commit-meta');
    expect(firstMeta?.textContent).toContain('zchange0000');
    expect(firstMeta?.textContent).toContain('Ada');
    expect(firstMeta?.textContent).not.toContain('merge');
    expect(firstMeta?.querySelectorAll('span')[1]?.getAttribute('title')).toBe(
      '2026-06-18T12:00:00Z',
    );
    expect(root.querySelector('.bookmark-chip')).toBeNull();
    expect(root.querySelector('.state-icon')).toBeNull();
    const menuButton = root.querySelector('.change-menu-button') as HTMLButtonElement;
    expect(menuButton.textContent).toContain('more_vert');
    expect(menuButton.getAttribute('title')).toBeNull();
    menuButton.click();
    await fixture.whenStable();

    expect(document.body.textContent).toContain('Check out');
    expect(document.body.textContent).toContain('Show files');
    expect(document.body.textContent).toContain('Abandon');
    expect(document.body.textContent).toContain('New from this');
    expect(document.body.textContent).toContain('Rebase onto trunk');
    expect(menuItem('Abandon')?.disabled).toBe(false);
    expect(menuItem('New from this')?.disabled).toBe(false);
    expect(root.textContent).not.toContain('adjust');
    expect(root.textContent).not.toContain('radio_button_unchecked');
  });

  it('should link the files action to the exact selected commit', async () => {
    fixture.componentRef.setInput('commits', [
      commit({ commitId: 'abc123', changeId: 'feature-change' }),
    ]);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    (root.querySelector('.change-menu-button') as HTMLButtonElement).click();
    await fixture.whenStable();

    const link = Array.from(document.body.querySelectorAll<HTMLAnchorElement>('a')).find((anchor) =>
      anchor.textContent?.includes('Show files'),
    );
    expect(link?.getAttribute('href')).toContain('/files?');
    expect(new URL(link?.href ?? '', globalThis.location.origin).searchParams.get('rev')).toBe(
      'feature-change',
    );
    expect(new URL(link?.href ?? '', globalThis.location.origin).searchParams.get('commitId')).toBe(
      'abc123',
    );
  });

  it('should emit menu actions for abandon, new from this, and rebase', async () => {
    const emitted: string[] = [];
    component.abandonRequested.subscribe((rev) => emitted.push(`abandon:${rev}`));
    component.newFromRequested.subscribe((rev) => emitted.push(`new:${rev}`));
    component.rebaseRequested.subscribe((rev) => emitted.push(`rebase:${rev}`));

    fixture.componentRef.setInput('commits', [commit({ commitId: 'abc' })]);
    fixture.componentRef.setInput('graphRows', [{ commitId: 'abc', graph: '○' }]);

    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const menuButton = root.querySelector('.change-menu-button') as HTMLButtonElement;

    menuButton.click();
    await fixture.whenStable();
    menuItem('Abandon')?.click();
    await fixture.whenStable();

    menuButton.click();
    await fixture.whenStable();
    menuItem('New from this')?.click();
    await fixture.whenStable();

    menuButton.click();
    await fixture.whenStable();
    menuItem('Rebase onto trunk')?.click();
    await fixture.whenStable();

    expect(emitted).toEqual(['abandon:abc', 'new:abc', 'rebase:abc']);
  });

  it('should mark divergent commits and emit the exact commit id', async () => {
    const selected: string[] = [];
    component.commitSelected.subscribe((rev) => selected.push(rev));
    fixture.componentRef.setInput('commits', [
      commit({
        commitId: 'leftcommit',
        changeId: 'sharedchange',
        shortChangeId: 'shared',
        changeOffset: 0,
        divergent: true,
      }),
      commit({
        commitId: 'rightcommit',
        changeId: 'sharedchange',
        shortChangeId: 'shared',
        changeOffset: 1,
        divergent: true,
      }),
    ]);

    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const firstGroup = root.querySelector<HTMLElement>('.change-group');
    expect(root.querySelectorAll('.divergent-icon').length).toBe(2);
    expect(root.textContent).toContain('shared/0');
    expect(firstGroup?.getAttribute('title')).toContain(
      'Divergent change: multiple visible commits',
    );

    firstGroup?.click();
    await fixture.whenStable();

    expect(selected).toEqual(['leftcommit']);
  });
});

function menuItem(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(label),
  );
}

function commit(value: Partial<Commit> & Pick<Commit, 'commitId'>): Commit {
  const changeId = value.changeId ?? `${value.commitId}-change`;
  return {
    commitId: value.commitId,
    shortCommitId: value.commitId.slice(0, 12),
    changeId,
    shortChangeId: value.shortChangeId ?? changeId.slice(0, 12),
    description: value.description ?? value.commitId,
    summary: value.summary ?? value.commitId,
    authorName: value.authorName ?? 'Ada',
    authorEmail: value.authorEmail ?? 'ada@example.com',
    authorTimestamp: value.authorTimestamp ?? '2026-06-18T12:00:00Z',
    current: value.current ?? false,
    empty: value.empty ?? false,
    changeOffset: value.changeOffset,
    divergent: value.divergent,
    bookmarks: value.bookmarks ?? [],
  };
}
