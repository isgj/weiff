import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { ConfirmDialog, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog';
import {
  WorkspaceCreateDialog,
  WorkspaceDialogData,
} from '../../components/workspace-create-dialog/workspace-create-dialog';
import { Workspace, WorkspaceMutation } from '../../data/repo-api';
import { RevisionDashboardState } from '../../data/revision-dashboard-state';

@Component({
  selector: 'app-worktrees-page',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './worktrees-page.html',
  styleUrl: './worktrees-page.scss',
})
export class WorktreesPage {
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly dashboard = inject(RevisionDashboardState);
  protected readonly workspaces = computed(() => this.dashboard.workspaces());

  protected openCreateWorkspaceDialog(): void {
    const target = this.dashboard.selectedTarget();
    const ref = this.dialog.open<WorkspaceCreateDialog, WorkspaceDialogData, WorkspaceMutation>(
      WorkspaceCreateDialog,
      {
        width: 'min(640px, calc(100vw - 32px))',
        data: { parentRev: target.rev, parentLabel: target.label },
      },
    );

    ref.afterClosed().subscribe((request) => {
      if (request == null) {
        return;
      }

      this.dashboard.createWorkspace(request);
    });
  }

  protected openWorkspace(root: string): void {
    this.dashboard.openWorkspacePath(root);
    void this.router.navigate(['/revisions'], { queryParamsHandling: 'preserve' });
  }

  protected openRevision(workspace: Workspace): void {
    if (workspace.target === '' && workspace.changeId === '') {
      return;
    }

    this.dashboard.selectCommit(workspace.target || workspace.changeId);
    void this.router.navigate(['/revisions'], {
      queryParams: revisionQueryParams(workspace.changeId || workspace.target, workspace.target),
      queryParamsHandling: 'merge',
    });
  }

  protected forgetWorkspace(name: string): void {
    if (name === '') {
      return;
    }

    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: {
        title: 'Forget workspace',
        message: `Forget workspace "${name}"? Its directory stays on disk, but jj stops tracking it.`,
        confirmLabel: 'Forget',
        icon: 'delete_forever',
      },
    });

    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed !== true) {
        return;
      }

      this.dashboard.forgetWorkspace(name);
    });
  }

  protected workspaceTitle(workspace: Workspace): string {
    return [
      `Workspace: ${workspace.name}`,
      `Directory: ${workspace.root}`,
      `Change: ${workspace.changeId || 'unknown'}`,
      `Commit: ${workspace.target || 'unknown'}`,
      `Description: ${workspace.summary || workspace.description || '(no description set)'}`,
    ].join('\n');
  }
}

function revisionQueryParams(rev: string, commitId: string): Record<string, string> {
  return commitId.trim() === '' ? { rev } : { rev, commitId };
}
