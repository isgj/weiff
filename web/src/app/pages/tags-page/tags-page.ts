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
import { ConfirmDialog, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog';
import {
  TagCreateDialog,
  TagDialogData,
} from '../../components/tag-create-dialog/tag-create-dialog';
import { Commit, Tag, TagMutation } from '../../data/repo-api';
import { RevisionDashboardState } from '../../data/revision-dashboard-state';

type TagScope = 'local' | 'tracked' | 'synced' | 'conflicted' | 'remote';
type TagChipTone = 'default' | 'primary' | 'error';

interface TagChip {
  label: string;
  icon: string;
  tone: TagChipTone;
}

interface TagRow {
  key: string;
  tag: Tag;
  relatedTags: Tag[];
  targetRev: string;
  targetChangeRev: string;
  targetLabel: string;
  targetSummary: string;
  scope: TagScope;
  chips: TagChip[];
}

interface PushTarget {
  remote: string;
  isNew: boolean;
}

@Component({
  selector: 'app-tags-page',
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
  templateUrl: './tags-page.html',
  styleUrl: './tags-page.scss',
})
export class TagsPage {
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  protected readonly dashboard = inject(RevisionDashboardState);
  protected readonly reachableTagPage = signal({ pageIndex: 0, pageSize: 10 });
  protected readonly otherTagPage = signal({ pageIndex: 0, pageSize: 10 });
  protected readonly otherTagFilter = signal('');
  protected readonly pageSizeOptions = [10, 25, 50, 100];
  protected readonly tagColumns = ['tag', 'target', 'status', 'actions'];

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
  protected readonly tagRows = computed(() => this.groupTagRows());
  private readonly existingTagNames = computed(() => this.tagRows().map((row) => row.tag.name));
  protected readonly reachableTags = computed(() =>
    this.tagRows().filter((row) => row.scope !== 'remote'),
  );
  protected readonly reachableTagPageIndex = computed(() =>
    safePageIndex(
      this.reachableTagPage().pageIndex,
      this.reachableTagPage().pageSize,
      this.reachableTags().length,
    ),
  );
  protected readonly pagedReachableTags = computed(() => {
    const rows = this.reachableTags();
    const page = this.reachableTagPage();
    const pageIndex = safePageIndex(page.pageIndex, page.pageSize, rows.length);
    const start = pageIndex * page.pageSize;
    return rows.slice(start, start + page.pageSize);
  });
  protected readonly otherTags = computed(() =>
    this.tagRows().filter((row) => row.scope === 'remote'),
  );
  protected readonly filteredOtherTags = computed(() => {
    const filter = normalizeFilter(this.otherTagFilter());
    if (filter === '') {
      return this.otherTags();
    }

    return this.otherTags().filter((row) => tagRowMatchesFilter(row, filter));
  });
  protected readonly otherTagPageIndex = computed(() =>
    safePageIndex(
      this.otherTagPage().pageIndex,
      this.otherTagPage().pageSize,
      this.filteredOtherTags().length,
    ),
  );
  protected readonly pagedOtherTags = computed(() => {
    const rows = this.filteredOtherTags();
    const page = this.otherTagPage();
    const pageIndex = safePageIndex(page.pageIndex, page.pageSize, rows.length);
    const start = pageIndex * page.pageSize;
    return rows.slice(start, start + page.pageSize);
  });

  protected setReachableTagPage(event: PageEvent): void {
    this.reachableTagPage.set({
      pageIndex: event.pageIndex,
      pageSize: event.pageSize,
    });
  }

  protected setOtherTagPage(event: PageEvent): void {
    this.otherTagPage.set({
      pageIndex: event.pageIndex,
      pageSize: event.pageSize,
    });
  }

  protected setOtherTagFilter(event: Event): void {
    this.otherTagFilter.set((event.target as HTMLInputElement).value);
    this.otherTagPage.update((page) => ({ ...page, pageIndex: 0 }));
  }

  protected clearOtherTagFilter(): void {
    this.otherTagFilter.set('');
    this.otherTagPage.update((page) => ({ ...page, pageIndex: 0 }));
  }

  protected openCreateTagDialog(): void {
    const target = this.selectedTarget();
    const ref = this.dialog.open<TagCreateDialog, TagDialogData, TagMutation>(TagCreateDialog, {
      data: {
        rev: target.rev,
        revLabel: target.label,
        revReadonly: false,
        existingNames: this.existingTagNames,
      },
    });

    ref.afterClosed().subscribe((request) => {
      if (request == null) {
        return;
      }

      this.dashboard.saveTag(request);
    });
  }

  protected openTag(row: TagRow): void {
    if (row.targetRev === '') {
      return;
    }

    this.dashboard.selectCommit(row.targetRev);
    void this.router.navigate(['/revisions'], {
      queryParams: revisionQueryParams(row.targetChangeRev || row.targetRev, row.targetRev),
      queryParamsHandling: 'merge',
    });
  }

  protected newFromTag(row: TagRow): void {
    if (row.targetRev === '') {
      return;
    }

    this.dashboard.newFrom(row.targetRev);
  }

  protected moveTag(row: TagRow): void {
    const rev = this.selectedTarget().rev.trim();
    if (!this.canMutate(row) || rev === '') {
      return;
    }

    this.dashboard.saveTag({
      name: row.tag.name,
      rev,
      allowMove: true,
    });
  }

  protected deleteTag(row: TagRow): void {
    if (!this.canMutate(row)) {
      return;
    }

    const name = row.tag.name;
    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: {
        title: 'Delete tag',
        message: `Delete tag "${name}"? The revision it points to is kept.`,
        confirmLabel: 'Delete',
        icon: 'delete',
      },
    });

    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed !== true) {
        return;
      }

      this.dashboard.deleteTag(name);
    });
  }

  protected pushTag(row: TagRow, remote?: string): void {
    if (!this.canMutate(row)) {
      return;
    }

    const targets = this.pushTargets(row);
    const target =
      remote != null ? targets.find((candidate) => candidate.remote === remote) : targets[0];
    this.dashboard.pushTag(row.tag.name, target?.remote);
  }

  protected pushTargets(row: TagRow): PushTarget[] {
    return this.remotes().map((remote) => ({
      remote: remote.name,
      isNew: !row.relatedTags.some((tag) => tag.remote === remote.name && tag.present),
    }));
  }

  protected canOpen(row: TagRow): boolean {
    return row.targetRev !== '';
  }

  protected canMutate(row: TagRow): boolean {
    return this.localTag(row) != null;
  }

  protected tagTitle(row: TagRow): string {
    const lines = [row.tag.name];
    for (const tag of row.relatedTags) {
      const scope = this.hasRemote(tag) ? `@${tag.remote}` : 'local';
      lines.push(`${scope}: ${tag.target || 'no normal target'}`);
    }

    return lines.join('\n');
  }

  private groupTagRows(): TagRow[] {
    const groups = new Map<string, Tag[]>();
    for (const tag of this.dashboard.tags()) {
      const current = groups.get(tag.name);
      if (current == null) {
        groups.set(tag.name, [tag]);
      } else {
        current.push(tag);
      }
    }

    return [...groups.values()].map((tags) => this.toTagRow(tags));
  }

  private toTagRow(tags: Tag[]): TagRow {
    const tag = this.primaryTag(tags);
    const targetRev = this.targetRev(tag);
    const targetCommit = this.commitForTag(tag);
    const scope = this.scopeForRow(tags);

    return {
      key: this.tagKey(tag),
      tag,
      relatedTags: tags,
      targetRev,
      targetChangeRev: targetCommit?.changeId ?? '',
      targetLabel: tag.shortTarget || shortID(tag.target) || 'No normal target',
      targetSummary: targetCommit?.summary ?? '',
      scope,
      chips: this.chipsForRow(tags, scope),
    };
  }

  private primaryTag(tags: Tag[]): Tag {
    return [...tags].sort((left, right) => this.tagScore(right) - this.tagScore(left))[0];
  }

  private targetRev(tag: Tag): string {
    const target = tag.target?.trim() ?? '';
    if (target === '') {
      return '';
    }

    return target;
  }

  private commitForTag(tag: Tag): Commit | null {
    const target = tag.target?.trim() ?? '';
    if (target === '') {
      return null;
    }

    return this.commitsByID().get(target) ?? this.commitsByChangeID().get(target) ?? null;
  }

  private scopeForRow(tags: Tag[]): TagScope {
    const local = this.localTagFor(tags);
    if (local != null) {
      return local.conflict ? 'conflicted' : 'local';
    }
    if (tags.some((tag) => tag.conflict)) {
      return 'conflicted';
    }
    if (tags.some((tag) => tag.tracked)) {
      return 'tracked';
    }
    if (tags.some((tag) => tag.synced)) {
      return 'synced';
    }

    return 'remote';
  }

  private chipsForRow(tags: Tag[], scope: TagScope): TagChip[] {
    const chips: TagChip[] = [];
    if (tags.some((tag) => tag.conflict)) {
      chips.push({ label: 'Conflict', icon: 'warning', tone: 'error' });
    }
    if (tags.some((tag) => !this.hasRemote(tag))) {
      chips.push({ label: 'Local', icon: 'person', tone: 'primary' });
    }
    if (tags.some((tag) => tag.tracked)) {
      chips.push({ label: 'Tracked', icon: 'sync', tone: 'primary' });
    } else if (scope === 'synced' || tags.some((tag) => tag.synced)) {
      chips.push({ label: 'Synced', icon: 'cloud_done', tone: 'primary' });
    }
    if (!chips.some((chip) => chip.label === 'Local') && scope === 'remote') {
      chips.push({ label: 'Remote', icon: 'cloud', tone: 'default' });
    }

    const remotes = [
      ...new Set(tags.map((tag) => tag.remote?.trim() ?? '').filter((remote) => remote !== '')),
    ];
    for (const remote of remotes) {
      chips.push({ label: remote, icon: 'dns', tone: 'default' });
    }
    if (tags.some((tag) => !tag.present)) {
      chips.push({ label: 'Missing local target', icon: 'link_off', tone: 'error' });
    }

    return chips;
  }

  private tagKey(tag: Tag): string {
    return `${tag.name}@${tag.remote ?? 'local'}:${tag.target ?? ''}`;
  }

  private hasRemote(tag: Tag): boolean {
    return (tag.remote?.trim() ?? '') !== '';
  }

  private localTag(row: Pick<TagRow, 'relatedTags'>): Tag | null {
    return this.localTagFor(row.relatedTags);
  }

  private localTagFor(tags: readonly Tag[]): Tag | null {
    return tags.find((tag) => !this.hasRemote(tag)) ?? null;
  }

  private tagScore(tag: Tag): number {
    let score = 0;
    if (!this.hasRemote(tag)) {
      score += 8;
    }
    if (tag.conflict) {
      score += 4;
    }
    if (tag.tracked) {
      score += 3;
    }
    if (tag.synced) {
      score += 2;
    }
    if (tag.present) {
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

function tagRowMatchesFilter(row: TagRow, filter: string): boolean {
  return [
    row.tag.name,
    row.tag.remote ?? '',
    row.tag.target ?? '',
    row.tag.shortTarget ?? '',
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
