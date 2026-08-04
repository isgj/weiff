import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { RepositoryFileEntry, RepositoryFilesResult } from '../../data/repo-api';
import { RevisionDashboardState } from '../../data/revision-dashboard-state';
import { highlightCode, languageForPath } from '../../shared/syntax-highlighter';

interface Breadcrumb {
  label: string;
  path: string;
}

@Component({
  selector: 'app-files-page',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, RouterLink],
  templateUrl: './files-page.html',
  styleUrl: './files-page.scss',
})
export class FilesPage {
  protected readonly dashboard = inject(RevisionDashboardState);
  protected readonly state = computed(() => this.dashboard.repositoryFiles());
  protected readonly breadcrumbs = computed(() =>
    buildBreadcrumbs(this.dashboard.repositoryFilePath()),
  );
  protected readonly highlightedContent = computed(() => {
    const state = this.state();
    if (state == null || state.kind === 'directory' || state.binary || state.truncated) {
      return '';
    }
    return highlightCode(state.content ?? '', languageForPath(state.path));
  });
  protected readonly lineNumbers = computed(() => {
    const state = this.state();
    if (state == null || state.kind === 'directory' || state.binary || state.truncated) {
      return '';
    }

    const content = state.content ?? '';
    const lines = content.split('\n');
    const lineCount = content.endsWith('\n') ? Math.max(1, lines.length - 1) : lines.length;
    return Array.from({ length: lineCount }, (_, index) => String(index + 1)).join('\n');
  });

  protected isWorkingCopyRevision(): boolean {
    return this.dashboard.selectedRev() === '@';
  }

  protected entryIcon(entry: Pick<RepositoryFileEntry, 'kind' | 'conflict'>): string {
    if (entry.conflict || entry.kind === 'conflict') {
      return 'warning_amber';
    }
    switch (entry.kind) {
      case 'directory':
        return 'folder';
      case 'symlink':
        return 'link';
      case 'git-submodule':
        return 'account_tree';
      default:
        return 'description';
    }
  }

  protected entryKindLabel(entry: Pick<RepositoryFileEntry, 'kind' | 'conflict'>): string {
    if (entry.conflict || entry.kind === 'conflict') {
      return 'Conflict';
    }
    switch (entry.kind) {
      case 'directory':
        return 'Directory';
      case 'symlink':
        return 'Symbolic link';
      case 'git-submodule':
        return 'Git submodule';
      default:
        return 'File';
    }
  }

  protected fileName(state: RepositoryFilesResult): string {
    return state.path.split('/').pop() ?? state.path;
  }

  protected previewLimit(maxBytes: number | undefined): string {
    return Math.max(1, Math.round((maxBytes ?? 0) / (1024 * 1024))) + ' MiB';
  }

  protected shortRevision(rev: string): string {
    return rev.length > 12 ? rev.slice(0, 12) : rev;
  }
}

function buildBreadcrumbs(path: string): Breadcrumb[] {
  const breadcrumbs: Breadcrumb[] = [];
  let current = '';
  for (const segment of path.split('/')) {
    if (segment === '') {
      continue;
    }
    current = current === '' ? segment : current + '/' + segment;
    breadcrumbs.push({ label: segment, path: current });
  }
  return breadcrumbs;
}
