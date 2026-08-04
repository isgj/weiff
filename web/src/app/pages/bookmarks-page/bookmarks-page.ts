import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import {
  BookmarkCreateDialog,
  BookmarkDialogData,
} from '../../components/bookmark-create-dialog/bookmark-create-dialog';
import { ConfirmDialog, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog';
import { Bookmark, BookmarkMutation, Commit } from '../../data/repo-api';
import { RevisionDashboardState } from '../../data/revision-dashboard-state';

type BookmarkScope = 'local' | 'tracked' | 'synced' | 'conflicted' | 'remote';
type BookmarkChipTone = 'default' | 'primary' | 'error';

interface BookmarkChip {
  label: string;
  icon: string;
  tone: BookmarkChipTone;
}

interface BookmarkRow {
  key: string;
  bookmark: Bookmark;
  relatedBookmarks: Bookmark[];
  targetRev: string;
  targetChangeRev: string;
  targetLabel: string;
  targetSummary: string;
  scope: BookmarkScope;
  chips: BookmarkChip[];
}

interface PushTarget {
  remote: string;
  isNew: boolean;
}

@Component({
  selector: 'app-bookmarks-page',
  imports: [
    NgTemplateOutlet,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './bookmarks-page.html',
  styleUrl: './bookmarks-page.scss',
})
export class BookmarksPage {
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  protected readonly dashboard = inject(RevisionDashboardState);
  protected readonly reachableBookmarkPage = signal({ pageIndex: 0, pageSize: 10 });
  protected readonly otherBookmarkPage = signal({ pageIndex: 0, pageSize: 10 });
  protected readonly otherBookmarkFilter = signal('');
  protected readonly pageSizeOptions = [10, 25, 50, 100];
  protected readonly bookmarkColumns = ['bookmark', 'target', 'status', 'actions'];

  private readonly commitsByID = computed(() => {
    const commits = this.dashboard.state()?.commits ?? [];
    return new Map(commits.map((commit) => [commit.commitId, commit]));
  });
  private readonly commitsByChangeID = computed(() => {
    const commits = this.dashboard.state()?.commits ?? [];
    return new Map(commits.map((commit) => [commit.changeId, commit]));
  });

  protected readonly selectedTarget = computed(() => this.dashboard.selectedTarget());
  protected readonly remotes = computed(() => this.dashboard.remotes());
  protected readonly bookmarkRows = computed(() => this.groupBookmarkRows());
  private readonly existingBookmarkNames = computed(() =>
    this.bookmarkRows().map((row) => row.bookmark.name),
  );
  protected readonly reachableBookmarks = computed(() =>
    this.bookmarkRows().filter((row) => row.scope !== 'remote'),
  );
  protected readonly reachableBookmarkPageIndex = computed(() =>
    safePageIndex(
      this.reachableBookmarkPage().pageIndex,
      this.reachableBookmarkPage().pageSize,
      this.reachableBookmarks().length,
    ),
  );
  protected readonly pagedReachableBookmarks = computed(() => {
    const rows = this.reachableBookmarks();
    const page = this.reachableBookmarkPage();
    const pageIndex = safePageIndex(page.pageIndex, page.pageSize, rows.length);
    const start = pageIndex * page.pageSize;
    return rows.slice(start, start + page.pageSize);
  });
  protected readonly otherBookmarks = computed(() =>
    this.bookmarkRows().filter((row) => row.scope === 'remote'),
  );
  protected readonly filteredOtherBookmarks = computed(() => {
    const filter = normalizeFilter(this.otherBookmarkFilter());
    if (filter === '') {
      return this.otherBookmarks();
    }

    return this.otherBookmarks().filter((row) => bookmarkRowMatchesFilter(row, filter));
  });
  protected readonly otherBookmarkPageIndex = computed(() =>
    safePageIndex(
      this.otherBookmarkPage().pageIndex,
      this.otherBookmarkPage().pageSize,
      this.filteredOtherBookmarks().length,
    ),
  );
  protected readonly pagedOtherBookmarks = computed(() => {
    const rows = this.filteredOtherBookmarks();
    const page = this.otherBookmarkPage();
    const pageIndex = safePageIndex(page.pageIndex, page.pageSize, rows.length);
    const start = pageIndex * page.pageSize;
    return rows.slice(start, start + page.pageSize);
  });

  protected setReachableBookmarkPage(event: PageEvent): void {
    this.reachableBookmarkPage.set({
      pageIndex: event.pageIndex,
      pageSize: event.pageSize,
    });
  }

  protected setOtherBookmarkPage(event: PageEvent): void {
    this.otherBookmarkPage.set({
      pageIndex: event.pageIndex,
      pageSize: event.pageSize,
    });
  }

  protected setOtherBookmarkFilter(event: Event): void {
    this.otherBookmarkFilter.set((event.target as HTMLInputElement).value);
    this.otherBookmarkPage.update((page) => ({ ...page, pageIndex: 0 }));
  }

  protected clearOtherBookmarkFilter(): void {
    this.otherBookmarkFilter.set('');
    this.otherBookmarkPage.update((page) => ({ ...page, pageIndex: 0 }));
  }

  protected openCreateBookmarkDialog(): void {
    const target = this.selectedTarget();
    const ref = this.dialog.open<BookmarkCreateDialog, BookmarkDialogData, BookmarkMutation>(
      BookmarkCreateDialog,
      {
        data: {
          rev: target.rev,
          revLabel: target.label,
          revReadonly: false,
          existingNames: this.existingBookmarkNames,
        },
      },
    );

    ref.afterClosed().subscribe((request) => {
      if (request == null) {
        return;
      }

      this.dashboard.saveBookmark(request);
    });
  }

  protected openBookmark(row: BookmarkRow): void {
    if (row.targetRev === '') {
      return;
    }

    this.dashboard.selectCommit(row.targetRev);
    void this.router.navigate(['/revisions'], {
      queryParams: revisionQueryParams(row.targetChangeRev || row.targetRev, row.targetRev),
      queryParamsHandling: 'merge',
    });
  }

  protected newFromBookmark(row: BookmarkRow): void {
    if (row.targetRev === '') {
      return;
    }

    this.dashboard.newFrom(row.targetRev);
  }

  protected moveBookmark(row: BookmarkRow): void {
    const rev = this.selectedTarget().rev.trim();
    if (!this.canMutate(row) || rev === '') {
      return;
    }

    this.dashboard.saveBookmark({
      name: row.bookmark.name,
      rev,
      allowBackwards: true,
    });
  }

  protected deleteBookmark(row: BookmarkRow): void {
    if (!this.canMutate(row)) {
      return;
    }

    const name = row.bookmark.name;
    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: {
        title: 'Delete bookmark',
        message: `Delete bookmark "${name}"? The revision it points to is kept.`,
        confirmLabel: 'Delete',
        icon: 'delete',
      },
    });

    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed !== true) {
        return;
      }

      this.dashboard.deleteBookmark(name);
    });
  }

  protected pushBookmark(row: BookmarkRow, remote?: string): void {
    if (!this.canMutate(row)) {
      return;
    }

    const targets = this.pushTargets(row);
    const target =
      remote != null ? targets.find((candidate) => candidate.remote === remote) : targets[0];
    this.dashboard.pushBookmark(row.bookmark.name, target?.remote, target?.isNew);
  }

  protected pushTargets(row: BookmarkRow): PushTarget[] {
    return this.remotes().map((remote) => ({
      remote: remote.name,
      isNew: !row.relatedBookmarks.some(
        (bookmark) => bookmark.remote === remote.name && bookmark.present,
      ),
    }));
  }

  protected canOpen(row: BookmarkRow): boolean {
    return row.targetRev !== '';
  }

  protected canMutate(row: BookmarkRow): boolean {
    return this.localBookmark(row) != null;
  }

  protected bookmarkTitle(row: BookmarkRow): string {
    const lines = [row.bookmark.name];
    for (const bookmark of row.relatedBookmarks) {
      const scope = this.hasRemote(bookmark) ? `@${bookmark.remote}` : 'local';
      lines.push(`${scope}: ${bookmark.target || 'no normal target'}`);
    }

    return lines.join('\n');
  }

  private groupBookmarkRows(): BookmarkRow[] {
    const groups = new Map<string, Bookmark[]>();
    for (const bookmark of this.dashboard.bookmarks()) {
      const current = groups.get(bookmark.name);
      if (current == null) {
        groups.set(bookmark.name, [bookmark]);
      } else {
        current.push(bookmark);
      }
    }

    return [...groups.values()].map((bookmarks) => this.toBookmarkRow(bookmarks));
  }

  private toBookmarkRow(bookmarks: Bookmark[]): BookmarkRow {
    const bookmark = this.primaryBookmark(bookmarks);
    const targetRev = this.targetRev(bookmark);
    const targetCommit = this.commitForBookmark(bookmark);
    const scope = this.scopeForRow(bookmarks);

    return {
      key: this.bookmarkKey(bookmark),
      bookmark,
      relatedBookmarks: bookmarks,
      targetRev,
      targetChangeRev: targetCommit?.changeId ?? '',
      targetLabel: bookmark.shortTarget || shortID(bookmark.target) || 'No normal target',
      targetSummary: targetCommit?.summary ?? '',
      scope,
      chips: this.chipsForRow(bookmarks, scope),
    };
  }

  private primaryBookmark(bookmarks: Bookmark[]): Bookmark {
    return [...bookmarks].sort(
      (left, right) => this.bookmarkScore(right) - this.bookmarkScore(left),
    )[0];
  }

  private targetRev(bookmark: Bookmark): string {
    const target = bookmark.target?.trim() ?? '';
    if (target === '') {
      return '';
    }

    return target;
  }

  private commitForBookmark(bookmark: Bookmark): Commit | null {
    const target = bookmark.target?.trim() ?? '';
    if (target === '') {
      return null;
    }

    return this.commitsByID().get(target) ?? this.commitsByChangeID().get(target) ?? null;
  }

  private scopeForRow(bookmarks: Bookmark[]): BookmarkScope {
    const local = this.localBookmarkFor(bookmarks);
    if (local != null) {
      return local.conflict ? 'conflicted' : 'local';
    }
    if (bookmarks.some((bookmark) => bookmark.conflict)) {
      return 'conflicted';
    }
    if (bookmarks.some((bookmark) => bookmark.tracked)) {
      return 'tracked';
    }
    if (bookmarks.some((bookmark) => bookmark.synced)) {
      return 'synced';
    }

    return 'remote';
  }

  private chipsForRow(bookmarks: Bookmark[], scope: BookmarkScope): BookmarkChip[] {
    const chips: BookmarkChip[] = [];
    if (bookmarks.some((bookmark) => bookmark.conflict)) {
      chips.push({ label: 'Conflict', icon: 'warning', tone: 'error' });
    }
    if (bookmarks.some((bookmark) => !this.hasRemote(bookmark))) {
      chips.push({ label: 'Local', icon: 'person', tone: 'primary' });
    }
    if (bookmarks.some((bookmark) => bookmark.tracked)) {
      chips.push({ label: 'Tracked', icon: 'sync', tone: 'primary' });
    } else if (scope === 'synced' || bookmarks.some((bookmark) => bookmark.synced)) {
      chips.push({ label: 'Synced', icon: 'cloud_done', tone: 'primary' });
    }
    if (!chips.some((chip) => chip.label === 'Local') && scope === 'remote') {
      chips.push({ label: 'Remote', icon: 'cloud', tone: 'default' });
    }

    const remotes = [
      ...new Set(
        bookmarks
          .map((bookmark) => bookmark.remote?.trim() ?? '')
          .filter((remote) => remote !== ''),
      ),
    ];
    for (const remote of remotes) {
      chips.push({ label: remote, icon: 'dns', tone: 'default' });
    }
    if (bookmarks.some((bookmark) => !bookmark.present)) {
      chips.push({ label: 'Missing local target', icon: 'link_off', tone: 'error' });
    }

    return chips;
  }

  private bookmarkKey(bookmark: Bookmark): string {
    return `${bookmark.name}@${bookmark.remote ?? 'local'}:${bookmark.target ?? ''}`;
  }

  private hasRemote(bookmark: Bookmark): boolean {
    return (bookmark.remote?.trim() ?? '') !== '';
  }

  private localBookmark(row: Pick<BookmarkRow, 'relatedBookmarks'>): Bookmark | null {
    return this.localBookmarkFor(row.relatedBookmarks);
  }

  private localBookmarkFor(bookmarks: readonly Bookmark[]): Bookmark | null {
    return bookmarks.find((bookmark) => !this.hasRemote(bookmark)) ?? null;
  }

  private bookmarkScore(bookmark: Bookmark): number {
    let score = 0;
    if (!this.hasRemote(bookmark)) {
      score += 8;
    }
    if (bookmark.conflict) {
      score += 4;
    }
    if (bookmark.tracked) {
      score += 3;
    }
    if (bookmark.synced) {
      score += 2;
    }
    if (bookmark.present) {
      score++;
    }

    return score;
  }
}

function shortID(value: string | undefined): string {
  if (value == null || value.length <= 12) {
    return value ?? '';
  }

  return value.slice(0, 12);
}

function safePageIndex(pageIndex: number, pageSize: number, totalRows: number): number {
  if (pageSize <= 0 || totalRows <= 0) {
    return 0;
  }

  return Math.min(pageIndex, Math.max(0, Math.ceil(totalRows / pageSize) - 1));
}

function normalizeFilter(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function bookmarkRowMatchesFilter(row: BookmarkRow, filter: string): boolean {
  return [
    row.bookmark.name,
    row.bookmark.remote ?? '',
    row.bookmark.target ?? '',
    row.bookmark.shortTarget ?? '',
    row.targetLabel,
    row.targetSummary,
    ...row.chips.map((chip) => chip.label),
  ]
    .join(' ')
    .toLocaleLowerCase()
    .includes(filter);
}

function revisionQueryParams(rev: string, commitId: string): Record<string, string> {
  return commitId.trim() === '' ? { rev } : { rev, commitId };
}
