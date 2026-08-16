import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelect, MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { ConnectionStatus } from './components/connection-status/connection-status';
import {
  RepoOpenDialog,
  RepoOpenDialogData,
  RepoOpenDialogResult,
} from './components/repo-open-dialog/repo-open-dialog';
import { RevisionDashboardState } from './data/revision-dashboard-state';

interface NavItem {
  label: string;
  icon: string;
  path: string;
  queryParams?: Record<string, string | null>;
  queryParamsHandling?: 'merge' | 'preserve';
}

const primaryNavItems: NavItem[] = [
  { path: '/revisions', label: 'Revisions', icon: 'account_tree' },
  {
    path: '/files',
    label: 'Files',
    icon: 'folder_open',
    queryParams: { rev: null, commitId: null, path: null },
    queryParamsHandling: 'merge',
  },
  { path: '/bookmarks', label: 'Bookmarks', icon: 'bookmarks' },
  { path: '/tags', label: 'Tags', icon: 'tag' },
  { path: '/workspaces', label: 'Workspaces', icon: 'drive_folder_upload' },
  { path: '/operation-log', label: 'Operation Log', icon: 'history' },
];

const secondaryNavActions: NavItem[] = [{ path: '/settings', label: 'Settings', icon: 'settings' }];
const navigationStorageKey = 'weiff.navigation';

@Component({
  selector: 'app-root',
  imports: [
    ConnectionStatus,
    MatButtonToggleModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSidenavModule,
    MatToolbarModule,
    MatTooltipModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly dialog = inject(MatDialog);
  protected readonly dashboard = inject(RevisionDashboardState);
  protected readonly compactLayout = toSignal(
    this.breakpointObserver.observe('(max-width: 719px)').pipe(map((state) => state.matches)),
    { initialValue: false },
  );
  protected readonly mobileNavigationOpen = signal(false);
  protected readonly navigationCollapsed = signal(readPersistedNavigationCollapsed());
  protected readonly primaryNavItems = primaryNavItems;
  protected readonly secondaryNavActions = secondaryNavActions;
  protected readonly openRepoValue = '__open_repository__';
  private readonly repoSelect = viewChild(MatSelect);

  constructor() {
    effect(() => {
      writePersistedNavigationCollapsed(this.navigationCollapsed());
    });
  }

  protected toggleNavigation(): void {
    if (this.compactLayout()) {
      this.mobileNavigationOpen.update((open) => !open);
      return;
    }
    this.navigationCollapsed.update((collapsed) => !collapsed);
  }

  protected closeMobileNavigation(): void {
    if (this.compactLayout()) {
      this.mobileNavigationOpen.set(false);
    }
  }

  protected selectRepo(value: string): void {
    if (value === this.openRepoValue) {
      const select = this.repoSelect();
      if (select != null) {
        select.value = this.dashboard.selectedRepoValue();
      }
      this.openRepoDialog();
      return;
    }

    this.dashboard.selectRepo(value);
  }

  protected openRepoDialog(): void {
    const ref = this.dialog.open<RepoOpenDialog, RepoOpenDialogData, RepoOpenDialogResult>(
      RepoOpenDialog,
      {
        data: {
          repoPath: this.dashboard.effectiveRepoPath(),
          knownPaths: this.dashboard.repoOptions().map((option) => option.value),
        } satisfies RepoOpenDialogData,
      },
    );

    ref.afterClosed().subscribe((result) => {
      if (result == null || result.path === '') {
        return;
      }

      this.dashboard.openRepo(result.path, result.name);
    });
  }
}

function readPersistedNavigationCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(navigationStorageKey) === 'collapsed';
  } catch {
    return false;
  }
}

function writePersistedNavigationCollapsed(collapsed: boolean): void {
  try {
    globalThis.localStorage?.setItem(navigationStorageKey, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // Ignore unavailable or full storage; navigation can still operate in memory.
  }
}
