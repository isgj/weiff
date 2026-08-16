import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  Bookmark,
  BookmarkMutation,
  ChangeDescription,
  Commit,
  EvolutionEntry,
  EvolutionLogResult,
  TagMutation,
} from '../../data/repo-api';
import {
  BookmarkCreateDialog,
  BookmarkDialogData,
} from '../bookmark-create-dialog/bookmark-create-dialog';
import { TagCreateDialog, TagDialogData } from '../tag-create-dialog/tag-create-dialog';
import { ConfirmDialog, ConfirmDialogData } from '../confirm-dialog/confirm-dialog';
import { DescribeDialog, DescribeDialogData } from '../describe-dialog/describe-dialog';
import { MarkdownPipe } from '../../shared/markdown.pipe';

@Component({
  selector: 'app-commit-detail',
  imports: [
    MatButtonModule,
    MatExpansionModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTabsModule,
    MatTooltipModule,
    MarkdownPipe,
  ],
  templateUrl: './commit-detail.html',
  styleUrl: './commit-detail.scss',
})
export class CommitDetail {
  private readonly dialog = inject(MatDialog);
  readonly commit = input<Commit | null>(null);
  readonly bookmarks = input<Bookmark[], Bookmark[] | null | undefined>([], {
    transform: (value) => value ?? [],
  });
  readonly selectedRev = input('');
  readonly loading = input(false);
  readonly evolutionLog = input<EvolutionLogResult | null>(null);
  readonly evolutionLoading = input(false);
  readonly evolutionError = input<string | null>(null);
  readonly selectedEvolutionCommitId = input<string | null>(null);

  readonly checkoutRequested = output<string>();
  readonly newFromRequested = output<string>();
  readonly describeRequested = output<{ rev: string; description: ChangeDescription }>();
  readonly abandonRequested = output<string>();
  readonly rebaseRequested = output<string>();
  readonly bookmarkSaved = output<BookmarkMutation>();
  readonly bookmarkDeleted = output<string>();
  readonly bookmarkPushed = output<string>();
  readonly tagSaved = output<TagMutation>();
  readonly tagDeleted = output<string>();
  readonly tagPushed = output<string>();
  readonly evolutionSelected = output<EvolutionEntry>();
  readonly evolutionCleared = output<void>();

  protected readonly detailsExpanded = signal(true);
  protected readonly selectedInfoTab = signal(0);
  protected readonly evolutionColumns = [
    'operation',
    'commit',
    'summary',
    'author',
    'time',
    'stats',
  ];
  protected readonly selectedBookmarks = computed(() => {
    const commit = this.commit();
    if (commit == null) {
      return [];
    }

    const localNames = new Set(commit.bookmarks ?? []);
    const selected = new Map<string, Bookmark>();
    for (const bookmark of this.bookmarks()) {
      if (!isBookmarkOnCommit(bookmark, commit, localNames)) {
        continue;
      }

      const current = selected.get(bookmark.name);
      if (
        current == null ||
        selectedBookmarkScore(bookmark, commit) > selectedBookmarkScore(current, commit)
      ) {
        selected.set(bookmark.name, bookmark);
      }
    }

    if (selected.size > 0) {
      return [...selected.values()];
    }

    return [...localNames].map((name) => ({
      name,
      target: commit.commitId,
      shortTarget: commit.shortCommitId,
      present: true,
      conflict: false,
      tracked: false,
      synced: false,
    }));
  });
  protected readonly messageBody = computed(() => {
    const commit = this.commit();
    if (commit == null) {
      return '';
    }

    return bodyWithoutSummary(commit.description);
  });
  protected readonly hasMessageBody = computed(() => this.messageBody().trim() !== '');
  protected readonly authorLine = computed(() => {
    const commit = this.commit();
    if (commit == null) {
      return 'unknown author';
    }

    if (commit.authorName !== '' && commit.authorEmail !== '') {
      return `${commit.authorName} <${commit.authorEmail}>`;
    }
    return commit.authorName || commit.authorEmail || 'unknown author';
  });
  protected readonly authoredAt = computed(() =>
    this.formatTimestamp(this.commit()?.authorTimestamp),
  );
  protected readonly selectedBookmarkTitle = computed(() => {
    const bookmarks = this.selectedBookmarks();
    if (bookmarks.length === 0) {
      return 'No bookmarks point at this commit.';
    }

    return bookmarks.map((bookmark) => bookmark.name).join('\n');
  });
  protected readonly selectedTagTitle = computed(() => {
    const tags = this.commit()?.tags ?? [];
    if (tags.length === 0) {
      return 'No tags point at this commit.';
    }

    return tags.join('\n');
  });
  protected readonly evolutionEntries = computed(() => this.evolutionLog()?.entries ?? []);
  private readonly existingBookmarkNames = computed(() => [
    ...new Set([
      ...this.bookmarks().map((bookmark) => bookmark.name),
      ...(this.commit()?.bookmarks ?? []),
    ]),
  ]);
  private readonly existingTagNames = computed(() => [...new Set(this.commit()?.tags ?? [])]);

  protected setInfoTab(index: number): void {
    this.selectedInfoTab.set(index);
    if (index === 0) {
      this.evolutionCleared.emit();
    }
  }

  protected selectEvolutionEntry(entry: EvolutionEntry): void {
    this.evolutionSelected.emit(entry);
  }

  protected setDetailsExpanded(expanded: boolean): void {
    this.detailsExpanded.set(expanded);
  }

  protected openBookmarkDialog(): void {
    const rev = this.selectedRev();
    if (rev === '') {
      return;
    }

    const commit = this.commit();
    const ref = this.dialog.open<BookmarkCreateDialog, BookmarkDialogData, BookmarkMutation>(
      BookmarkCreateDialog,
      {
        data: {
          rev,
          revLabel: commit?.summary ?? '',
          revReadonly: true,
          existingNames: this.existingBookmarkNames,
        },
      },
    );

    ref.afterClosed().subscribe((request) => {
      if (request == null) {
        return;
      }

      this.bookmarkSaved.emit(request);
    });
  }

  protected openTagDialog(): void {
    const rev = this.selectedRev();
    if (rev === '') {
      return;
    }

    const commit = this.commit();
    const ref = this.dialog.open<TagCreateDialog, TagDialogData, TagMutation>(TagCreateDialog, {
      data: {
        rev,
        revLabel: commit?.summary ?? '',
        revReadonly: true,
        existingNames: this.existingTagNames,
      },
    });

    ref.afterClosed().subscribe((request) => {
      if (request == null) {
        return;
      }

      this.tagSaved.emit(request);
    });
  }

  protected deleteTag(tag: string): void {
    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: {
        title: 'Delete tag',
        message: `Delete tag "${tag}"? The commit it points to is kept.`,
        confirmLabel: 'Delete',
        icon: 'delete',
      },
    });

    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed !== true) {
        return;
      }

      this.tagDeleted.emit(tag);
    });
  }

  protected checkout(): void {
    const commit = this.commit();
    if (commit == null || commit.current) {
      return;
    }

    this.checkoutRequested.emit(this.revFor(commit));
  }

  protected newFrom(): void {
    const commit = this.commit();
    if (commit == null) {
      return;
    }

    this.newFromRequested.emit(this.revFor(commit));
  }

  protected editDescription(): void {
    const commit = this.commit();
    if (commit == null) {
      return;
    }

    const rev = this.revFor(commit);
    const ref = this.dialog.open<DescribeDialog, DescribeDialogData, ChangeDescription>(
      DescribeDialog,
      {
        width: '560px',
        maxWidth: 'calc(100vw - 32px)',
        data: {
          rev,
          title: firstLine(commit.description),
          body: bodyWithoutSummary(commit.description),
        },
      },
    );

    ref.afterClosed().subscribe((description) => {
      if (description == null) {
        return;
      }

      this.describeRequested.emit({ rev, description });
    });
  }

  protected abandon(): void {
    const commit = this.commit();
    if (commit == null) {
      return;
    }

    const rev = this.revFor(commit);
    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: {
        title: 'Abandon revision',
        message: `Abandon revision ${rev}? Its changes are discarded and descendants are rebased onto its parent.`,
        confirmLabel: 'Abandon',
        icon: 'delete_sweep',
      },
    });

    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed !== true) {
        return;
      }

      this.abandonRequested.emit(rev);
    });
  }

  protected rebase(): void {
    const commit = this.commit();
    if (commit == null) {
      return;
    }

    this.rebaseRequested.emit(this.revFor(commit));
  }

  protected copyCommitId(): void {
    const commit = this.commit();
    if (commit != null) {
      this.copyToClipboard(commit.commitId);
    }
  }

  protected copyChangeId(): void {
    const commit = this.commit();
    if (commit != null) {
      this.copyToClipboard(commit.changeId);
    }
  }

  protected bookmarkTitle(bookmark: Bookmark, commit: Commit): string {
    return [
      bookmark.name,
      `Target: ${bookmark.target || commit.commitId}`,
      `Commit: ${commit.commitId}`,
      `Change: ${commit.changeId}`,
    ].join('\n');
  }

  protected tagTitle(tag: string, commit: Commit): string {
    return [`Tag: ${tag}`, `Commit: ${commit.commitId}`, `Change: ${commit.changeId}`].join('\n');
  }

  protected formatEntryTimestamp(value: string): string {
    return this.formatTimestamp(value);
  }

  protected operationTitle(entry: EvolutionEntry): string {
    return [
      entry.operationDescription || 'No operation description',
      `Operation: ${entry.operationId}`,
      `Commit: ${entry.commitId}`,
      `Predecessors: ${entry.predecessors.length > 0 ? entry.predecessors.join(', ') : 'none'}`,
    ].join('\n');
  }

  protected evolutionRowTitle(entry: EvolutionEntry): string {
    return [
      entry.summary || '(no description set)',
      `Change: ${entry.changeId}`,
      `Commit: ${entry.commitId}`,
      `Operation: ${entry.operationId}`,
    ].join('\n');
  }

  protected evolutionAuthorTitle(entry: EvolutionEntry): string {
    if (entry.authorName !== '' && entry.authorEmail !== '') {
      return `${entry.authorName} <${entry.authorEmail}>`;
    }

    return entry.authorName || entry.authorEmail || 'unknown author';
  }

  protected divergentTitle(commit: Commit): string {
    return [
      'Divergent change: multiple visible commits share this change ID.',
      `Change: ${commit.changeId}`,
      `Selected commit: ${commit.commitId}`,
    ].join('\n');
  }

  private revFor(commit: Commit): string {
    return commit.commitId || commit.changeId;
  }

  private copyToClipboard(value: string): void {
    if (value === '') {
      return;
    }

    void globalThis.navigator?.clipboard?.writeText(value);
  }

  private formatTimestamp(value: string | undefined): string {
    if (value == null || value === '') {
      return 'unknown time';
    }

    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.valueOf())) {
      return value;
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(timestamp);
  }
}

function firstLine(description: string): string {
  return description.replace(/\r\n/g, '\n').split('\n')[0] ?? '';
}

function bodyWithoutSummary(description: string): string {
  const lines = description.replace(/\r\n/g, '\n').split('\n');
  if (lines.length <= 1) {
    return '';
  }

  return lines.slice(1).join('\n').trim();
}

function isBookmarkOnCommit(
  bookmark: Bookmark,
  commit: Commit,
  localNames: ReadonlySet<string>,
): boolean {
  if (bookmark.target === commit.commitId) {
    return true;
  }

  return !bookmark.remote && localNames.has(bookmark.name);
}

function selectedBookmarkScore(bookmark: Bookmark, commit: Commit): number {
  let score = 0;
  if (bookmark.target === commit.commitId) {
    score += 4;
  }
  if (!bookmark.remote) {
    score += 2;
  }
  if (bookmark.present) {
    score++;
  }
  if (!bookmark.conflict) {
    score++;
  }

  return score;
}
