import { ClipboardModule } from '@angular/cdk/clipboard';
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { DiffFile, DiffResult, HunkRestoreRequest, RepoApi } from '../../data/repo-api';
import {
  ContextGap,
  DiffRenderer,
  ExpandedGap,
  RenderedDiffFile,
  RenderedDiffHunk,
  RenderedDiffLine,
  SplitDiffRow,
} from './diff-renderer';

export type DiffMode = 'inline' | 'split';

@Component({
  selector: 'app-diff-view',
  imports: [
    ClipboardModule,
    NgTemplateOutlet,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatChipsModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './diff-view.html',
  styleUrl: './diff-view.scss',
})
export class DiffView {
  readonly diff = input<DiffResult | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly mode = input<DiffMode>('inline');
  readonly restorable = input(false);
  readonly ignoreWhitespace = input(false);

  readonly restoreFileRequested = output<string>();
  readonly restoreHunkRequested = output<HunkRestoreRequest>();
  readonly modeChanged = output<DiffMode>();
  readonly ignoreWhitespaceChanged = output<boolean>();

  private readonly api = inject(RepoApi);
  private readonly renderer = new DiffRenderer();
  private readonly fileContentCache = new Map<string, Promise<string>>();
  protected readonly expandedGaps = signal<ReadonlyMap<string, ExpandedGap>>(new Map());
  protected readonly openPath = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.diff();
      this.fileContentCache.clear();
      this.expandedGaps.set(new Map());
    });
  }
  protected readonly filterText = signal('');
  protected readonly files = computed<RenderedDiffFile[]>(() =>
    this.renderer.buildFiles(this.diff()),
  );
  protected readonly visibleFiles = computed<RenderedDiffFile[]>(() => {
    const filter = this.filterText().trim().toLowerCase();
    const files = this.files();
    if (filter === '') {
      return files;
    }
    return files.filter((file) => file.path.toLowerCase().includes(filter));
  });

  protected lineClass(line: RenderedDiffLine): string {
    return `diff-line diff-line-${line.kind}`;
  }

  protected rowClass(row: SplitDiffRow): string {
    return `split-row split-row-${row.kind}`;
  }

  protected isExpanded(file: DiffFile): boolean {
    return this.openPath() === file.path;
  }

  protected openFile(path: string): void {
    this.openPath.set(path);
  }

  protected closeFile(file: DiffFile): void {
    this.openPath.update((path) => (path === file.path ? null : path));
  }

  protected setFilter(event: Event): void {
    this.filterText.set((event.target as HTMLInputElement).value);
  }

  protected clearFilter(): void {
    this.filterText.set('');
  }

  protected diffLimitLabel(maxBytes: number): string {
    return `${Math.max(1, Math.round(maxBytes / (1024 * 1024)))} MiB`;
  }

  protected requestFileRestore(file: DiffFile, event: Event): void {
    event.stopPropagation();
    this.restoreFileRequested.emit(file.path);
  }

  protected requestHunkRestore(file: DiffFile, hunk: RenderedDiffHunk): void {
    if (hunk.restore == null) {
      return;
    }
    this.restoreHunkRequested.emit({ path: file.path, ...hunk.restore });
  }

  protected gapLabel(gap: ContextGap): string {
    if (gap.newEnd == null) {
      return 'Expand remaining lines';
    }
    const count = gap.newEnd - gap.newStart + 1;
    return count === 1 ? 'Expand 1 hidden line' : `Expand ${count} hidden lines`;
  }

  protected async expandGap(file: RenderedDiffFile, gap: ContextGap): Promise<void> {
    const diff = this.diff();
    if (diff == null || this.expandedGaps().has(gap.key)) {
      return;
    }

    let content: string;
    try {
      content = await this.fileContentFor(diff, gap.path);
    } catch {
      return;
    }

    const allLines = content.split('\n');
    if (allLines.at(-1) === '') {
      allLines.pop();
    }
    const endLine = Math.min(gap.newEnd ?? allLines.length, allLines.length);
    const lines: RenderedDiffLine[] = [];
    for (let n = gap.newStart; n <= endLine; n++) {
      lines.push(
        this.renderer.renderLine('context', allLines[n - 1], n + gap.lineDelta, n, file.language),
      );
    }

    this.expandedGaps.update((gaps) =>
      new Map(gaps).set(gap.key, { lines, splitRows: this.renderer.buildSplitRows(lines) }),
    );
  }

  private fileContentFor(diff: DiffResult, path: string): Promise<string> {
    const key = `${diff.repoPath}\u0000${diff.rev}\u0000${path}`;
    let promise = this.fileContentCache.get(key);
    if (promise == null) {
      promise = firstValueFrom(this.api.fileContent(diff.rev, path, diff.repoPath)).then(
        (result) => result.content,
      );
      promise.catch(() => this.fileContentCache.delete(key));
      this.fileContentCache.set(key, promise);
    }
    return promise;
  }
}
