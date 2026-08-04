import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';

@Service()
export class RepoApi {
  private readonly http = inject(HttpClient);

  checkout(rev: string, repoPath: string) {
    return this.http.post<CommandResult>('/api/checkout', { rev, repoPath });
  }

  newFrom(rev: string, repoPath: string) {
    return this.http.post<CommandResult>('/api/changes/new', { rev, repoPath });
  }

  describe(rev: string, description: ChangeDescription, repoPath: string) {
    return this.http.post<CommandResult>('/api/changes/describe', {
      rev,
      ...description,
      repoPath,
    });
  }

  abandon(rev: string, repoPath: string) {
    return this.http.post<CommandResult>('/api/changes/abandon', { rev, repoPath });
  }

  rebase(rev: string, repoPath: string) {
    return this.http.post<CommandResult>('/api/changes/rebase', { rev, repoPath });
  }

  restorePaths(rev: string, paths: string[], repoPath: string) {
    return this.http.post<CommandResult>('/api/changes/restore-paths', { rev, paths, repoPath });
  }

  restoreHunk(rev: string, hunk: HunkRestoreRequest, repoPath: string) {
    return this.http.post<CommandResult>('/api/changes/restore-hunk', { rev, ...hunk, repoPath });
  }

  fileContent(rev: string, path: string, repoPath: string) {
    const params = new URLSearchParams({ rev, path });
    if (repoPath.trim() !== '') {
      params.set('repoPath', repoPath.trim());
    }
    return this.http.get<FileContentResult>(`/api/file-content?${params.toString()}`);
  }

  fetch(repoPath: string) {
    return this.http.post<CommandResult>('/api/repo/fetch', { repoPath });
  }

  createBookmark(request: BookmarkMutation) {
    return this.http.post<CommandResult>('/api/bookmarks', request);
  }

  updateBookmark(request: BookmarkMutation) {
    return this.http.put<CommandResult>(
      `/api/bookmarks/${encodeURIComponent(request.name)}`,
      request,
    );
  }

  deleteBookmark(name: string, repoPath: string) {
    return this.http.delete<CommandResult>(
      this.withRepoPath(`/api/bookmarks/${encodeURIComponent(name)}`, repoPath),
    );
  }

  pushBookmark(name: string, repoPath: string, remote?: string, allowNew?: boolean) {
    return this.http.post<CommandResult>(`/api/bookmarks/${encodeURIComponent(name)}/push`, {
      repoPath,
      ...(remote != null && remote !== '' ? { remote } : {}),
      ...(allowNew ? { allowNew } : {}),
    });
  }

  remotes(repoPath: string) {
    return this.http.get<RemotesResult>(this.withRepoPath('/api/remotes', repoPath));
  }

  createWorkspace(request: WorkspaceMutation) {
    return this.http.post<CommandResult>('/api/workspaces', request);
  }

  forgetWorkspace(name: string, repoPath: string) {
    return this.http.delete<CommandResult>(
      this.withRepoPath(`/api/workspaces/${encodeURIComponent(name)}`, repoPath),
    );
  }

  restoreOperation(operationId: string, repoPath: string) {
    return this.http.post<CommandResult>(
      `/api/operations/${encodeURIComponent(operationId)}/restore`,
      { repoPath },
    );
  }

  undoLastOperation(repoPath: string) {
    return this.http.post<CommandResult>('/api/operations/undo', { repoPath });
  }

  browseDirs(path: string) {
    const trimmed = path.trim();
    const query = trimmed === '' ? '' : `?${new URLSearchParams({ path: trimmed }).toString()}`;
    return this.http.get<BrowseDirsResult>(`/api/browse/dirs${query}`);
  }

  private withRepoPath(url: string, repoPath: string): string {
    const trimmed = repoPath.trim();
    if (trimmed === '') {
      return url;
    }

    const params = new URLSearchParams({ repoPath: trimmed });
    return `${url}?${params.toString()}`;
  }
}

export interface BrowseDirEntry {
  name: string;
  path: string;
  isRepo: boolean;
}

export interface BrowseDirsResult {
  path: string;
  parent: string;
  isRepo: boolean;
  dirs: BrowseDirEntry[];
}

export interface RepoState {
  repoPath: string;
  vcs: string;
  currentCommitId: string;
  commits: Commit[];
  graphRows: GraphRow[];
  generatedAt: string;
}

export interface CommitResult {
  repoPath: string;
  vcs: string;
  rev: string;
  commit: Commit;
  generatedAt: string;
}

export interface GraphRow {
  commitId?: string;
  graph: string;
}

export interface Commit {
  commitId: string;
  shortCommitId: string;
  changeId: string;
  shortChangeId: string;
  changeOffset?: number;
  description: string;
  summary: string;
  authorName: string;
  authorEmail: string;
  authorTimestamp: string;
  current: boolean;
  empty: boolean;
  divergent?: boolean;
  bookmarks: string[];
}

export interface Bookmark {
  name: string;
  remote?: string;
  target?: string;
  shortTarget?: string;
  present: boolean;
  conflict: boolean;
  tracked: boolean;
  synced: boolean;
}

export interface BookmarksResult {
  repoPath: string;
  vcs: string;
  bookmarks: Bookmark[];
  generatedAt: string;
}

export interface Remote {
  name: string;
  url: string;
}

export interface RemotesResult {
  repoPath: string;
  vcs: string;
  remotes: Remote[];
  generatedAt: string;
}

export interface Workspace {
  name: string;
  root: string;
  target: string;
  shortTarget: string;
  changeId: string;
  shortChangeId: string;
  description: string;
  summary: string;
  current: boolean;
}

export interface WorkspacesResult {
  repoPath: string;
  vcs: string;
  workspaces: Workspace[];
  generatedAt: string;
}

export interface OperationLogResult {
  repoPath: string;
  vcs: string;
  operations: OperationEntry[];
  limit: number;
  hasMore: boolean;
  generatedAt: string;
}

export interface OperationEntry {
  id: string;
  shortId: string;
  parents: string[];
  shortParents: string[];
  description: string;
  user: string;
  timestamp: string;
  current: boolean;
  snapshot: boolean;
  workspaceName: string;
  root: boolean;
  attributes: string;
}

export interface DiffResult {
  repoPath: string;
  vcs: string;
  rev: string;
  command: string[];
  diff: string;
  files: DiffFile[];
  truncated: boolean;
  maxBytes: number;
  generatedAt: string;
}

export interface DiffFile {
  path: string;
  status: string;
  statusChar: string;
  conflict: boolean;
  lines: DiffLine[];
}

export interface DiffLine {
  kind: 'header' | 'meta' | 'file' | 'hunk' | 'added' | 'removed' | 'context';
  content: string;
}

export interface HunkRestoreRequest {
  path: string;
  newStart: number;
  lines: string[];
}

export interface FileContentResult {
  repoPath: string;
  rev: string;
  path: string;
  content: string;
  generatedAt: string;
}

export type RepositoryFileKind = 'directory' | 'file' | 'symlink' | 'git-submodule' | 'conflict';

export interface RepositoryFileEntry {
  name: string;
  path: string;
  kind: RepositoryFileKind;
  conflict?: boolean;
  executable?: boolean;
}

export interface RepositoryFilesResult {
  repoPath: string;
  vcs: string;
  rev: string;
  path: string;
  kind: RepositoryFileKind;
  entries: RepositoryFileEntry[];
  content?: string;
  binary?: boolean;
  truncated?: boolean;
  maxBytes?: number;
  conflict?: boolean;
  executable?: boolean;
  generatedAt: string;
}

export interface ChangeDescription {
  title: string;
  body: string;
}

export interface EvolutionLogResult {
  repoPath: string;
  vcs: string;
  rev: string;
  entries: EvolutionEntry[];
  generatedAt: string;
}

export interface EvolutionEntry {
  commitId: string;
  shortCommitId: string;
  changeId: string;
  shortChangeId: string;
  description: string;
  summary: string;
  authorName: string;
  authorEmail: string;
  authorTimestamp: string;
  operationId: string;
  shortOperationId: string;
  operationDescription: string;
  operationUser: string;
  operationTimestamp: string;
  predecessors: string[];
  shortPredecessors: string[];
  filesChanged: number;
  totalAdded: number;
  totalRemoved: number;
}

export interface BookmarkMutation {
  name: string;
  rev: string;
  repoPath?: string;
  allowBackwards: boolean;
}

export interface WorkspaceMutation {
  destination: string;
  name?: string;
  rev?: string;
  message?: string;
  sparsePatterns?: 'copy' | 'full' | 'empty';
  repoPath?: string;
}

export interface CommandResult {
  repoPath: string;
  vcs: string;
  command: string[];
  message: string;
  generatedAt: string;
}
