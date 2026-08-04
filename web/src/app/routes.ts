import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'revisions' },
  {
    path: 'revisions',
    loadComponent: () =>
      import('./pages/revisions-page/revisions-page').then((m) => m.RevisionsPage),
    title: 'Revisions',
  },
  {
    path: 'bookmarks',
    loadComponent: () =>
      import('./pages/bookmarks-page/bookmarks-page').then((m) => m.BookmarksPage),
    title: 'Bookmarks',
  },
  {
    path: 'workspaces',
    loadComponent: () =>
      import('./pages/worktrees-page/worktrees-page').then((m) => m.WorktreesPage),
    title: 'Workspaces',
  },
  { path: 'worktrees', pathMatch: 'full', redirectTo: 'workspaces' },
  {
    path: 'operation-log',
    loadComponent: () =>
      import('./pages/operation-log-page/operation-log-page').then((m) => m.OperationLogPage),
    title: 'Operation Log',
  },
  {
    path: 'files',
    loadComponent: () => import('./pages/files-page/files-page').then((m) => m.FilesPage),
    title: 'Files',
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings-page/settings-page').then((m) => m.SettingsPage),
    title: 'Settings',
  },
  { path: '**', redirectTo: 'revisions' },
];
