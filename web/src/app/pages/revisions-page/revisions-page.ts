import { Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { CommitDetail } from '../../components/commit-detail/commit-detail';
import { CommitGraph } from '../../components/commit-graph/commit-graph';
import { ConfirmDialog, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog';
import { DiffView } from '../../components/diff-view/diff-view';
import { HunkRestoreRequest } from '../../data/repo-api';
import { RevisionDashboardState } from '../../data/revision-dashboard-state';

@Component({
  selector: 'app-revisions-page',
  imports: [CommitDetail, CommitGraph, DiffView],
  templateUrl: './revisions-page.html',
  styleUrl: './revisions-page.scss',
})
export class RevisionsPage {
  protected readonly dashboard = inject(RevisionDashboardState);
  private readonly dialog = inject(MatDialog);

  protected restoreFile(path: string): void {
    this.confirmRestore(
      {
        title: 'Restore file',
        message: `Restore "${path}" to its content in the parent revision? This discards the changes to this file in the selected revision.`,
        confirmLabel: 'Restore',
        icon: 'settings_backup_restore',
      },
      () => this.dashboard.restorePaths([path]),
    );
  }

  protected restoreHunk(hunk: HunkRestoreRequest): void {
    this.confirmRestore(
      {
        title: 'Restore hunk',
        message: `Restore this hunk of "${hunk.path}" to its content in the parent revision? This discards the selected changes.`,
        confirmLabel: 'Restore',
        icon: 'settings_backup_restore',
      },
      () => this.dashboard.restoreHunk(hunk),
    );
  }

  private confirmRestore(data: ConfirmDialogData, action: () => void): void {
    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data,
    });

    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed !== true) {
        return;
      }

      action();
    });
  }
}
