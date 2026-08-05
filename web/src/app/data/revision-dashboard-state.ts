import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { computed, effect, inject, linkedSignal, Service, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DiffMode } from '../components/diff-view/diff-view';
import { AppSettings } from '../core/app-settings';
import { ThemeService } from '../core/theme.service';
import {
  BookmarksResult,
  BookmarkMutation,
  ChangeDescription,
  Commit,
  CommitResult,
  DiffResult,
  EvolutionEntry,
  EvolutionLogResult,
  HunkRestoreRequest,
  OperationLogResult,
  RemotesResult,
  RepositoryFilesResult,
  RepoApi,
  RepoState,
  WorkspaceMutation,
  WorkspacesResult,
} from './repo-api';
import { RepositoryConfigStore, RepositoryPreference } from './repository-config';

const settingsStorageKey = 'weiff.settings';

interface PersistedSettings {
  diffMode: DiffMode;
}

type ActivePage = 'revisions' | 'bookmarks' | 'workspaces' | 'operation-log' | 'files' | 'other';

interface RevisionSelection {
  rev: string | null;
  commitId: string | null;
}

interface RevisionSelectionSource {
  requested: RevisionSelection;
  commits: readonly Commit[];
}

export interface RepoOption {
  value: string;
  label: string;
  detail: string;
}

@Service()
export class RevisionDashboardState {
  private readonly api = inject(RepoApi);
  private readonly router = inject(Router);
  private readonly repositoryConfigStore = inject(RepositoryConfigStore);
  private readonly theme = inject(ThemeService);
  private readonly persistedRepositoryConfig = this.repositoryConfigStore.snapshot();
  private readonly persistedSettings = readPersistedSettings();
  private readonly queryParams = new URLSearchParams(globalThis.location.search);
  private readonly queryRepoPath = this.queryParams.get('repoPath');
  private readonly initialRepoPath =
    this.queryRepoPath ?? this.persistedRepositoryConfig.currentRepository;
  private readonly initialLogRevset = this.persistedRepositoryConfig.logRevset;

  private readonly repoPathOverride = signal(this.initialRepoPath);
  private readonly knownRepoPaths = signal<string[]>(
    uniqueRepoPaths([
      this.initialRepoPath,
      ...this.persistedRepositoryConfig.repositories.map((repository) => repository.path),
    ]),
  );
  private readonly repoNames = signal<Record<string, string>>(
    repositoryNames(this.persistedRepositoryConfig.repositories),
  );
  private readonly logRevset = signal(this.initialLogRevset);
  private readonly requestedSelection = signal(revisionSelectionFromParams(this.queryParams));
  readonly repositoryFilePath = signal(this.queryParams.get('path') ?? '');
  private readonly activePage = signal<ActivePage>('other');
  private readonly routeActivation = signal(0);
  private reloadRevisionDetailsAfterState = false;

  readonly selectedEvolutionCommitId = signal<string | null>(null);
  readonly revsetDraft = signal(this.initialLogRevset);
  readonly diffMode = signal<DiffMode>(this.persistedSettings.diffMode);
  readonly diffIgnoreWhitespace = signal(false);
  private readonly operationLimit = signal(50);
  readonly themeMode = this.theme.mode;
  readonly actionToggleValue = signal<string | null>(null);
  readonly actionLoading = signal(false);
  readonly actionError = signal<string | null>(null);

  readonly activeRepoPath = computed(() => this.repoPathOverride().trim());
  readonly effectiveRepoPath = computed(() => {
    const activeRepoPath = this.activeRepoPath();
    if (activeRepoPath !== '') {
      return activeRepoPath;
    }
    if (this.state()?.repoPath) {
      return this.state()?.repoPath ?? '';
    }
    if (this.bookmarksResource.hasValue() && this.bookmarksResource.value().repoPath !== '') {
      return this.bookmarksResource.value().repoPath;
    }
    if (this.workspacesResource.hasValue() && this.workspacesResource.value().repoPath !== '') {
      return this.workspacesResource.value().repoPath;
    }
    if (this.operationsResource.hasValue() && this.operationsResource.value().repoPath !== '') {
      return this.operationsResource.value().repoPath;
    }
    if (
      this.repositoryFilesResource.hasValue() &&
      this.repositoryFilesResource.value().repoPath !== ''
    ) {
      return this.repositoryFilesResource.value().repoPath;
    }
    return '';
  });
  readonly selectedRepoValue = computed(() => this.effectiveRepoPath());
  readonly repoOptions = computed<RepoOption[]>(() => {
    const options: RepoOption[] = [];
    const activeRepoPath = this.activeRepoPath();
    const paths = new Set(
      this.knownRepoPaths()
        .map((path) => path.trim())
        .filter(Boolean),
    );
    if (activeRepoPath !== '') {
      paths.add(activeRepoPath);
    }
    const backendRepoPath = this.state()?.repoPath ?? '';
    if (backendRepoPath !== '') {
      paths.add(backendRepoPath);
    }
    if (this.bookmarksResource.hasValue() && this.bookmarksResource.value().repoPath !== '') {
      paths.add(this.bookmarksResource.value().repoPath);
    }
    if (this.workspacesResource.hasValue() && this.workspacesResource.value().repoPath !== '') {
      paths.add(this.workspacesResource.value().repoPath);
    }
    if (this.operationsResource.hasValue() && this.operationsResource.value().repoPath !== '') {
      paths.add(this.operationsResource.value().repoPath);
    }
    if (
      this.repositoryFilesResource.hasValue() &&
      this.repositoryFilesResource.value().repoPath !== ''
    ) {
      paths.add(this.repositoryFilesResource.value().repoPath);
    }

    for (const path of paths) {
      options.push({
        value: path,
        label: this.repoLabel(path),
        detail: path,
      });
    }

    return options;
  });
  readonly rememberedRepoPaths = computed(() => new Set(this.knownRepoPaths()));
  readonly selectedRepoLabel = computed(() => {
    const repoPath = this.effectiveRepoPath();
    if (repoPath !== '') {
      return this.repoLabel(repoPath);
    }

    return 'Select repository';
  });
  readonly stateResource = httpResource<RepoState>(() => this.stateURL());
  readonly state = computed(() =>
    this.stateResource.hasValue() ? this.stateResource.value() : null,
  );
  private readonly stateRefreshOutcome = computed(() => ({
    state: this.state(),
    error: this.stateResource.error(),
    isLoading: this.stateResource.isLoading(),
  }));
  private readonly selection = linkedSignal<RevisionSelectionSource, RevisionSelection>({
    source: () => ({
      requested: this.requestedSelection(),
      commits: this.state()?.commits ?? [],
    }),
    computation: (source, previous) => reconcileSelection(source, previous),
    equal: sameRevisionSelection,
  });
  private readonly revSel = computed(() => this.selection().rev);
  private readonly commitSel = computed(() => this.selection().commitId);
  readonly bookmarksResource = httpResource<BookmarksResult>(() => this.bookmarksURL());
  readonly bookmarks = computed(() =>
    this.activePage() === 'bookmarks' && this.bookmarksResource.hasValue()
      ? this.bookmarksResource.value().bookmarks
      : [],
  );
  readonly remotesResource = httpResource<RemotesResult>(() => this.remotesURL());
  readonly remotes = computed(() =>
    this.activePage() === 'bookmarks' && this.remotesResource.hasValue()
      ? this.remotesResource.value().remotes
      : [],
  );
  readonly workspacesResource = httpResource<WorkspacesResult>(() => this.workspacesURL());
  readonly workspaces = computed(() =>
    this.activePage() === 'workspaces' && this.workspacesResource.hasValue()
      ? this.workspacesResource.value().workspaces
      : [],
  );
  readonly operationsResource = httpResource<OperationLogResult>(() => this.operationsURL());
  readonly operationLog = computed(() =>
    this.activePage() === 'operation-log' && this.operationsResource.hasValue()
      ? this.operationsResource.value()
      : null,
  );
  readonly operations = computed(() => this.operationLog()?.operations ?? []);
  readonly hasMoreOperations = computed(() => this.operationLog()?.hasMore ?? false);
  readonly repositoryFilesResource = httpResource<RepositoryFilesResult>(() =>
    this.repositoryFilesURL(),
  );
  readonly repositoryFiles = computed(() =>
    this.activePage() === 'files' && this.repositoryFilesResource.hasValue()
      ? this.repositoryFilesResource.value()
      : null,
  );
  readonly selectedRev = computed(() => {
    const selected = this.revSel();
    return selected == null ? '@' : this.stableRevFor(selected);
  });
  readonly selectedCommitResource = httpResource<CommitResult>(() => this.selectedCommitURL());
  private readonly resolvedCommit = linkedSignal<
    { selection: RevisionSelection; commit: Commit | null },
    Commit | null
  >({
    source: () => ({
      selection: this.selection(),
      commit: this.selectedCommitResource.hasValue()
        ? this.selectedCommitResource.value().commit
        : null,
    }),
    computation: (source, previous) => {
      if (source.commit != null && selectionMatchesCommit(source.selection, source.commit)) {
        return source.commit;
      }

      const cached = previous?.value ?? null;
      return cached != null && selectionMatchesCommit(source.selection, cached) ? cached : null;
    },
  });
  readonly selectedCommit = computed(() => {
    const commits = this.state()?.commits ?? [];
    const selected = this.revSel();
    const selectedCommitId = this.commitSel();
    if (selectedCommitId != null) {
      const commit = commits.find((candidate) => candidate.commitId === selectedCommitId);
      if (
        commit != null &&
        (selected == null || commit.commitId === selected || commit.changeId === selected)
      ) {
        return commit;
      }
    }
    if (selected != null) {
      return this.commitForRev(selected) ?? this.resolvedCommit();
    }

    const currentCommitId = this.state()?.currentCommitId;
    return (
      commits.find((commit) => commit.current) ??
      commits.find((commit) => commit.commitId === currentCommitId) ??
      null
    );
  });
  readonly selectedTarget = computed(() => {
    const selectedCommit = this.selectedCommit();
    if (selectedCommit != null) {
      return { rev: selectedCommit.commitId, label: selectedCommit.summary };
    }

    const selectedRev = this.selectedRev();
    return { rev: selectedRev, label: selectedRev };
  });
  readonly diffResource = httpResource<DiffResult>(() => this.diffURL());
  readonly diff = computed(() => (this.diffResource.hasValue() ? this.diffResource.value() : null));
  readonly evolutionResource = httpResource<EvolutionLogResult>(() => this.evolutionURL());
  readonly evolutionLog = computed(() =>
    this.evolutionResource.hasValue() ? this.evolutionResource.value() : null,
  );
  readonly evolutionError = computed(() => this.errorMessage(this.evolutionResource.error()));
  readonly loading = computed(() => this.pageLoading() || this.actionLoading());
  readonly error = computed(() => this.actionError() ?? this.pageError());

  constructor() {
    toObservable(this.stateRefreshOutcome)
      .pipe(takeUntilDestroyed())
      .subscribe((outcome) => {
        if (!this.reloadRevisionDetailsAfterState || outcome.isLoading) {
          return;
        }

        this.reloadRevisionDetailsAfterState = false;
        if (outcome.error == null && outcome.state != null) {
          this.reloadRevisionDetails();
        }
      });
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        const selection = revisionSelectionFromURL(event.urlAfterRedirects);
        if (!sameRevisionSelection(this.requestedSelection(), selection)) {
          this.requestedSelection.set(selection);
          this.selectedEvolutionCommitId.set(null);
        }
        const repositoryFilePath = repositoryFilePathFromURL(event.urlAfterRedirects);
        if (this.repositoryFilePath() !== repositoryFilePath) {
          this.repositoryFilePath.set(repositoryFilePath);
        }
        this.activatePage(pageFromURL(event.urlAfterRedirects));
      }
    });
    effect(() => {
      const repoPath = this.activeRepoPath();
      const repoNames = this.repoNames();
      this.repositoryConfigStore.save({
        currentRepository: repoPath,
        repositories: uniqueRepoPaths([repoPath, ...this.knownRepoPaths()]).map((path) => {
          const name = repoNames[path]?.trim() ?? '';
          return name === '' ? { path } : { path, name };
        }),
        logRevset: this.logRevset(),
      });
    });
    effect(() => {
      writePersistedSettings({ diffMode: this.diffMode() });
    });
    effect(() => {
      if (this.activePage() === 'other') {
        return;
      }

      const selected = this.revSel();
      if (selected == null) {
        this.replaceSelectionQuery({ rev: null, commitId: null });
        return;
      }

      const selectedCommit = this.selectedCommit();
      this.replaceSelectionQuery({
        rev: selectedCommit?.changeId ?? this.stableRevFor(selected),
        commitId: selectedCommit?.commitId ?? this.commitSel(),
      });
    });
  }

  refresh(): void {
    this.setActionToggleUntilIdle('refresh');
    this.actionError.set(null);
    this.reloadCurrentPage();
  }

  applySettings(settings: AppSettings): void {
    this.diffMode.set(settings.diffMode);
    this.theme.setMode(settings.themeMode);
  }

  selectRepo(value: string): void {
    this.setRepoPath(value);
  }

  openRepo(repoPath: string, name?: string): void {
    const cleaned = repoPath.trim();
    if (cleaned === '') {
      return;
    }

    this.knownRepoPaths.update((paths) => (paths.includes(cleaned) ? paths : [cleaned, ...paths]));
    const cleanedName = name?.trim() ?? '';
    if (cleanedName !== '') {
      this.repoNames.update((names) => ({ ...names, [cleaned]: cleanedName }));
    }
    this.setRepoPath(cleaned);
  }

  forgetRepo(repoPath: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    const cleaned = repoPath.trim();
    if (cleaned === '') {
      return;
    }

    const remaining = this.knownRepoPaths().filter((path) => path !== cleaned);
    this.knownRepoPaths.set(remaining);
    this.repoNames.update((names) => {
      if (!(cleaned in names)) {
        return names;
      }
      const { [cleaned]: _removed, ...rest } = names;
      return rest;
    });

    if (this.activeRepoPath() === cleaned) {
      this.setRepoPath(remaining[0] ?? '');
    } else {
      this.actionError.set(null);
    }
  }

  isRememberedRepo(repoPath: string): boolean {
    return this.rememberedRepoPaths().has(repoPath);
  }

  setRevsetDraft(event: Event): void {
    this.revsetDraft.set((event.target as HTMLInputElement).value);
  }

  applyLogRevset(): void {
    this.logRevset.set(this.revsetDraft().trim());
    this.setSelectedRev(null);
    this.actionError.set(null);
  }

  clearLogRevset(): void {
    this.revsetDraft.set('');
    this.logRevset.set('');
    this.setSelectedRev(null);
    this.actionError.set(null);
  }

  fetchRepo(): void {
    this.setActionToggleUntilIdle('fetch');
    void this.runAction(async () => {
      await firstValueFrom(this.api.fetch(this.effectiveRepoPath()));
      this.setSelectedRev(null);
    });
  }

  selectCommit(rev: string): void {
    if (rev === '') {
      return;
    }
    this.selectRevInput(rev);
  }

  selectEvolutionEntry(entry: EvolutionEntry): void {
    if (entry.commitId === '') {
      return;
    }

    this.selectedEvolutionCommitId.set(entry.commitId);
  }

  clearEvolutionSelection(): void {
    this.selectedEvolutionCommitId.set(null);
  }

  checkout(rev: string): void {
    const actionRev = this.exactRevFor(rev);
    void this.runAction(async () => {
      await firstValueFrom(this.api.checkout(actionRev, this.effectiveRepoPath()));
      this.selectRevInput(actionRev);
    });
  }

  newFrom(rev: string): void {
    const actionRev = this.exactRevFor(rev);
    void this.runAction(async () => {
      await firstValueFrom(this.api.newFrom(actionRev, this.effectiveRepoPath()));
      this.setSelectedRev(null);
    });
  }

  describe(rev: string, description: ChangeDescription): void {
    const actionRev = this.exactRevFor(rev);
    void this.runAction(async () => {
      await firstValueFrom(this.api.describe(actionRev, description, this.effectiveRepoPath()));
    });
  }

  abandon(rev: string): void {
    const actionRev = this.exactRevFor(rev);
    void this.runAction(async () => {
      await firstValueFrom(this.api.abandon(actionRev, this.effectiveRepoPath()));
      if (this.isSelectedRev(actionRev)) {
        this.setSelectedRev(null);
      }
    });
  }

  rebase(rev: string): void {
    const actionRev = this.exactRevFor(rev);
    void this.runAction(async () => {
      await firstValueFrom(this.api.rebase(actionRev, this.effectiveRepoPath()));
      this.selectRevInput(actionRev);
    });
  }

  restorePaths(paths: string[]): void {
    const rev = this.diff()?.rev ?? '';
    if (rev === '' || paths.length === 0 || this.selectedEvolutionCommitId() != null) {
      return;
    }

    void this.runAction(async () => {
      await firstValueFrom(this.api.restorePaths(rev, paths, this.effectiveRepoPath()));
    });
  }

  restoreHunk(hunk: HunkRestoreRequest): void {
    const rev = this.diff()?.rev ?? '';
    if (rev === '' || this.selectedEvolutionCommitId() != null) {
      return;
    }

    void this.runAction(async () => {
      await firstValueFrom(this.api.restoreHunk(rev, hunk, this.effectiveRepoPath()));
    });
  }

  saveBookmark(request: BookmarkMutation): void {
    void this.runAction(async () => {
      const exists = this.bookmarks().some((bookmark) => bookmark.name === request.name);
      const requestWithPath = { ...request, repoPath: this.effectiveRepoPath() };
      const result = exists
        ? this.api.updateBookmark(requestWithPath)
        : this.api.createBookmark(requestWithPath);
      await firstValueFrom(result);
    });
  }

  deleteBookmark(name: string): void {
    void this.runAction(async () => {
      await firstValueFrom(this.api.deleteBookmark(name, this.effectiveRepoPath()));
    });
  }

  pushBookmark(name: string, remote?: string, allowNew?: boolean): void {
    void this.runAction(async () => {
      await firstValueFrom(this.api.pushBookmark(name, this.effectiveRepoPath(), remote, allowNew));
    });
  }

  createWorkspace(request: WorkspaceMutation): void {
    void this.runAction(async () => {
      await firstValueFrom(
        this.api.createWorkspace({ ...request, repoPath: this.effectiveRepoPath() }),
      );
    });
  }

  forgetWorkspace(name: string): void {
    void this.runAction(async () => {
      await firstValueFrom(this.api.forgetWorkspace(name, this.effectiveRepoPath()));
    });
  }

  restoreOperation(operationID: string): void {
    const cleaned = operationID.trim();
    if (cleaned === '') {
      return;
    }

    void this.runAction(async () => {
      await firstValueFrom(this.api.restoreOperation(cleaned, this.effectiveRepoPath()));
    });
  }

  undoLastOperation(): void {
    void this.runAction(async () => {
      await firstValueFrom(this.api.undoLastOperation(this.effectiveRepoPath()));
    });
  }

  openWorkspacePath(repoPath: string): void {
    const cleaned = repoPath.trim();
    if (cleaned === '') {
      return;
    }

    this.knownRepoPaths.update((paths) => (paths.includes(cleaned) ? paths : [cleaned, ...paths]));
    this.setRepoPath(cleaned);
  }

  private setRepoPath(repoPath: string): void {
    this.repoPathOverride.set(repoPath);
    this.setSelectedRev(null);
    this.actionError.set(null);
  }

  private setActionToggleUntilIdle(value: string): void {
    this.actionToggleValue.set(value);
    let sawLoading = false;
    let attempts = 0;

    const waitForIdle = () => {
      attempts++;
      if (this.loading()) {
        sawLoading = true;
      }
      if (!this.loading() && (sawLoading || attempts > 4)) {
        this.actionToggleValue.set(null);
        return;
      }

      window.setTimeout(waitForIdle, 50);
    };

    window.setTimeout(waitForIdle, 50);
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    this.actionLoading.set(true);
    this.actionError.set(null);
    try {
      await action();
      this.reloadCurrentPage();
    } catch (err) {
      this.actionError.set(this.errorMessage(err) ?? 'Command failed.');
    } finally {
      this.actionLoading.set(false);
    }
  }

  private activatePage(page: ActivePage): void {
    if (this.activePage() === page) {
      return;
    }

    this.activePage.set(page);
    this.routeActivation.update((value) => value + 1);
    this.actionError.set(null);
  }

  loadOlderOperations(): void {
    if (!this.hasMoreOperations() || this.operationsResource.isLoading()) {
      return;
    }
    this.operationLimit.update((limit) => Math.min(limit + 50, 500));
  }

  private reloadCurrentPage(): void {
    switch (this.activePage()) {
      case 'revisions':
        this.reloadRevisions();
        break;
      case 'bookmarks':
        this.bookmarksResource.reload();
        break;
      case 'workspaces':
        this.workspacesResource.reload();
        break;
      case 'operation-log':
        this.operationsResource.reload();
        break;
      case 'files':
        this.repositoryFilesResource.reload();
        break;
      case 'other':
        break;
    }
  }

  private reloadRevisions(): void {
    if (this.stateResource.reload() || this.stateResource.isLoading()) {
      this.reloadRevisionDetailsAfterState = true;
      return;
    }

    this.reloadRevisionDetails();
  }

  private reloadRevisionDetails(): void {
    this.selectedCommitResource.reload();
    this.diffResource.reload();
    this.evolutionResource.reload();
  }

  private pageLoading(): boolean {
    switch (this.activePage()) {
      case 'revisions':
        return (
          this.stateResource.isLoading() ||
          this.selectedCommitResource.isLoading() ||
          this.diffResource.isLoading()
        );
      case 'bookmarks':
        return this.bookmarksResource.isLoading();
      case 'workspaces':
        return this.workspacesResource.isLoading();
      case 'operation-log':
        return this.operationsResource.isLoading();
      case 'files':
        return this.repositoryFilesResource.isLoading();
      case 'other':
        return false;
    }
  }

  private pageError(): string | null {
    switch (this.activePage()) {
      case 'revisions':
        return (
          this.errorMessage(this.stateResource.error()) ??
          this.errorMessage(this.selectedCommitResource.error()) ??
          this.errorMessage(this.diffResource.error())
        );
      case 'bookmarks':
        return this.errorMessage(this.bookmarksResource.error());
      case 'workspaces':
        return this.errorMessage(this.workspacesResource.error());
      case 'operation-log':
        return this.errorMessage(this.operationsResource.error());
      case 'files':
        return this.errorMessage(this.repositoryFilesResource.error());
      case 'other':
        return null;
    }
  }

  private errorMessage(err: unknown): string | null {
    if (err == null) {
      return null;
    }

    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (typeof body === 'object' && body !== null && 'error' in body) {
        const failure = (body as { error?: unknown }).error;
        if (typeof failure === 'string') {
          return failure;
        }
        if (typeof failure === 'object' && failure !== null && 'message' in failure) {
          const message = (failure as { message?: unknown }).message;
          if (typeof message === 'string') {
            return message;
          }
        }
      }
      if (typeof body === 'string') {
        return body;
      }
      return err.message;
    }

    if (err instanceof Error) {
      return err.message;
    }

    return 'Unable to load repository diff.';
  }

  private stateURL(): string | undefined {
    if (this.activePage() !== 'revisions' || !this.hasActiveRepository()) {
      return undefined;
    }

    const params = new URLSearchParams({ limit: '80' });
    params.set('_route', String(this.routeActivation()));
    this.appendRepoPath(params);
    const revset = this.logRevset();
    if (revset !== '') {
      params.set('revset', revset);
    }
    return `/api/state?${params.toString()}`;
  }

  private bookmarksURL(): string | undefined {
    if (this.activePage() !== 'bookmarks' || !this.hasActiveRepository()) {
      return undefined;
    }

    const params = new URLSearchParams();
    params.set('_route', String(this.routeActivation()));
    this.appendRepoPath(params);
    return withQuery('/api/bookmarks', params);
  }

  private remotesURL(): string | undefined {
    if (this.activePage() !== 'bookmarks' || !this.hasActiveRepository()) {
      return undefined;
    }

    const params = new URLSearchParams();
    params.set('_route', String(this.routeActivation()));
    this.appendRepoPath(params);
    return withQuery('/api/remotes', params);
  }

  private workspacesURL(): string | undefined {
    if (this.activePage() !== 'workspaces' || !this.hasActiveRepository()) {
      return undefined;
    }

    const params = new URLSearchParams();
    params.set('_route', String(this.routeActivation()));
    this.appendRepoPath(params);
    return withQuery('/api/workspaces', params);
  }

  private operationsURL(): string | undefined {
    if (this.activePage() !== 'operation-log' || !this.hasActiveRepository()) {
      return undefined;
    }

    const params = new URLSearchParams();
    params.set('_route', String(this.routeActivation()));
    params.set('limit', String(this.operationLimit()));
    this.appendRepoPath(params);
    return `/api/operations?${params.toString()}`;
  }

  private repositoryFilesURL(): string | undefined {
    if (this.activePage() !== 'files' || !this.hasActiveRepository()) {
      return undefined;
    }

    const params = new URLSearchParams();
    params.set('_route', String(this.routeActivation()));
    params.set('rev', this.selectedRev());
    const commitID = this.commitSel();
    if (commitID != null) {
      params.set('commitId', commitID);
    }
    this.appendRepoPath(params);
    const path = this.repositoryFilePath();
    if (path !== '') {
      params.set('path', path);
    }
    return withQuery('/api/repo/files', params);
  }

  private selectedCommitURL(): string | undefined {
    if (this.activePage() !== 'revisions' || !this.hasActiveRepository()) {
      return undefined;
    }

    const selected = this.revSel();
    if (selected == null || this.commitForRev(selected) != null) {
      return undefined;
    }

    const params = new URLSearchParams({ rev: selected });
    const commitId = this.commitSel();
    if (commitId != null) {
      params.set('commitId', commitId);
    }
    params.set('_route', String(this.routeActivation()));
    this.appendRepoPath(params);
    return `/api/commit?${params.toString()}`;
  }

  private diffURL(): string | undefined {
    if (this.activePage() !== 'revisions' || !this.hasActiveRepository()) {
      return undefined;
    }

    const selectedEvolutionCommitId = this.selectedEvolutionCommitId();
    const params = new URLSearchParams({
      rev: selectedEvolutionCommitId == null ? this.selectedRev() : this.evolutionRev(),
    });
    params.set('_route', String(this.routeActivation()));
    this.appendRepoPath(params);
    if (selectedEvolutionCommitId != null) {
      params.set('commitId', selectedEvolutionCommitId);
      return `/api/evolution-diff?${params.toString()}`;
    }
    this.appendCommitId(params);

    if (this.diffIgnoreWhitespace()) {
      params.set('ignoreWhitespace', 'true');
    }
    return `/api/diff?${params.toString()}`;
  }

  private evolutionURL(): string | undefined {
    if (
      this.activePage() !== 'revisions' ||
      !this.hasActiveRepository() ||
      this.selectedCommit() == null
    ) {
      return undefined;
    }

    const params = new URLSearchParams({ rev: this.changeRev(), limit: '40' });
    this.appendCommitId(params);
    params.set('_route', String(this.routeActivation()));
    this.appendRepoPath(params);
    return `/api/evolution-log?${params.toString()}`;
  }

  private changeRev(): string {
    if (this.revSel() == null) {
      return '@';
    }

    return this.selectedCommit()?.changeId || this.selectedRev();
  }

  private evolutionRev(): string {
    if (this.revSel() == null) {
      return '@';
    }

    return this.selectedCommit()?.commitId || this.selectedRev();
  }

  private appendRepoPath(params: URLSearchParams): void {
    const repoPath = this.activeRepoPath();
    if (repoPath !== '') {
      params.set('repoPath', repoPath);
    }
  }

  private hasActiveRepository(): boolean {
    return this.activeRepoPath() !== '';
  }

  private appendCommitId(params: URLSearchParams): void {
    if (this.revSel() == null) {
      return;
    }

    const commitId = this.selectedCommit()?.commitId ?? this.commitSel();
    if (commitId != null && commitId !== '') {
      params.set('commitId', commitId);
    }
  }

  private setSelectedRev(rev: string | null): void {
    const selected = selectedRevFromQuery(rev);
    const stableSelected = selected == null ? null : this.stableRevFor(selected);
    this.selectedEvolutionCommitId.set(null);
    this.requestedSelection.set({ rev: stableSelected, commitId: null });
  }

  private selectRevInput(rev: string): void {
    const selected = selectedRevFromQuery(rev);
    if (selected == null) {
      this.setSelectedRev(null);
      return;
    }

    const commit = this.commitForRev(selected);
    this.selectedEvolutionCommitId.set(null);
    this.requestedSelection.set({
      rev: commit?.changeId ?? this.stableRevFor(selected),
      commitId: commit?.commitId ?? null,
    });
  }

  private stableRevFor(rev: string): string {
    const cleaned = cleanString(rev);
    if (cleaned === '') {
      return cleaned;
    }

    return this.commitForRev(cleaned)?.changeId ?? cleaned;
  }

  private exactRevFor(rev: string): string {
    const cleaned = cleanString(rev);
    if (cleaned === '') {
      return cleaned;
    }

    return this.commitForRev(cleaned)?.commitId ?? cleaned;
  }

  private commitForRev(rev: string): Commit | null {
    const commits = this.state()?.commits ?? [];
    const byCommitId = commits.find((commit) => commit.commitId === rev);
    if (byCommitId != null) {
      return byCommitId;
    }

    const byChangeId = commits.filter((commit) => commit.changeId === rev);
    if (byChangeId.length === 1) {
      return byChangeId[0];
    }

    const selectedCommitId = this.commitSel();
    if (selectedCommitId != null) {
      return byChangeId.find((commit) => commit.commitId === selectedCommitId) ?? null;
    }

    return null;
  }

  private isSelectedRev(rev: string): boolean {
    const selected = this.revSel();
    if (selected === rev) {
      return true;
    }
    if (this.commitSel() === rev) {
      return true;
    }

    const selectedCommit = this.selectedCommit();
    return selectedCommit?.changeId === rev || selectedCommit?.commitId === rev;
  }

  private replaceSelectionQuery(selection: RevisionSelection): void {
    const tree = this.router.parseUrl(this.router.url);
    const queryParams = { ...tree.queryParams };
    if (selection.rev == null) {
      delete queryParams['rev'];
      delete queryParams['commitId'];
    } else {
      queryParams['rev'] = selection.rev;
      if (selection.commitId == null || selection.commitId === '') {
        delete queryParams['commitId'];
      } else {
        queryParams['commitId'] = selection.commitId;
      }
    }
    tree.queryParams = queryParams;

    if (this.router.serializeUrl(tree) !== this.router.url) {
      void this.router.navigateByUrl(tree, { replaceUrl: true });
    }
  }

  private repoLabel(repoPath: string): string {
    const customName = this.repoNames()[repoPath]?.trim() ?? '';
    if (customName !== '') {
      return customName;
    }

    const normalized = repoPath.replace(/\/+$/, '');
    if (normalized === '') {
      return 'Select repository';
    }

    const lastSeparator = normalized.lastIndexOf('/');
    return lastSeparator < 0 ? normalized : normalized.slice(lastSeparator + 1);
  }
}

function readPersistedSettings(): PersistedSettings {
  try {
    const raw = globalThis.localStorage?.getItem(settingsStorageKey);
    if (raw == null) {
      return emptySettings();
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return emptySettings();
    }

    return {
      diffMode: cleanDiffMode(parsed['diffMode']),
    };
  } catch {
    return emptySettings();
  }
}

function writePersistedSettings(settings: PersistedSettings): void {
  try {
    globalThis.localStorage?.setItem(
      settingsStorageKey,
      JSON.stringify({ diffMode: settings.diffMode }),
    );
  } catch {
    // Ignore unavailable or full storage; the app can still operate with in-memory settings.
  }
}

function emptySettings(): PersistedSettings {
  return { diffMode: 'inline' };
}

function cleanDiffMode(value: unknown): DiffMode {
  return value === 'split' ? 'split' : 'inline';
}

function uniqueRepoPaths(paths: readonly string[]): string[] {
  const result: string[] = [];
  for (const path of paths) {
    const cleaned = path.trim();
    if (cleaned !== '' && !result.includes(cleaned)) {
      result.push(cleaned);
    }
    if (result.length >= 20) {
      break;
    }
  }
  return result;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function repositoryNames(repositories: readonly RepositoryPreference[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const repository of repositories) {
    const path = repository.path.trim();
    const name = repository.name?.trim() ?? '';
    if (path !== '' && name !== '') {
      result[path] = name;
    }
  }
  return result;
}

function selectedRevFromQuery(value: string | null): string | null {
  const cleaned = cleanString(value);
  return cleaned === '' || cleaned === '@' ? null : cleaned;
}

function revisionSelectionFromParams(params: Pick<URLSearchParams, 'get'>): RevisionSelection {
  const rev = selectedRevFromQuery(params.get('rev'));
  return {
    rev,
    commitId: rev == null ? null : selectedRevFromQuery(params.get('commitId')),
  };
}

function revisionSelectionFromURL(url: string): RevisionSelection {
  try {
    return revisionSelectionFromParams(new URL(url, globalThis.location.origin).searchParams);
  } catch {
    const query = url.split('?', 2)[1]?.split('#', 1)[0] ?? '';
    return revisionSelectionFromParams(new URLSearchParams(query));
  }
}

function repositoryFilePathFromURL(url: string): string {
  try {
    return new URL(url, globalThis.location.origin).searchParams.get('path') ?? '';
  } catch {
    const query = url.split('?', 2)[1]?.split('#', 1)[0] ?? '';
    return new URLSearchParams(query).get('path') ?? '';
  }
}

function reconcileSelection(
  source: RevisionSelectionSource,
  previous?: { source: RevisionSelectionSource; value: RevisionSelection },
): RevisionSelection {
  const requested = source.requested;
  if (requested.rev == null) {
    return { rev: null, commitId: null };
  }

  const requestedChanged =
    previous == null || !sameRevisionSelection(requested, previous.source.requested);
  const preferred = requestedChanged ? requested : previous.value;
  const rev = preferred.rev ?? requested.rev;
  const commitId = preferred.commitId ?? requested.commitId;

  const direct = source.commits.find((commit) => commit.commitId === rev);
  if (direct != null) {
    return selectionForCommit(direct);
  }

  if (commitId != null) {
    const exact = source.commits.find(
      (commit) =>
        commit.commitId === commitId && (commit.commitId === rev || commit.changeId === rev),
    );
    if (exact != null) {
      return selectionForCommit(exact);
    }
  }

  const matchingChanges = source.commits.filter((commit) => commit.changeId === rev);
  if (matchingChanges.length === 1) {
    return selectionForCommit(matchingChanges[0]);
  }

  return { rev, commitId };
}

function selectionForCommit(commit: Commit): RevisionSelection {
  return { rev: commit.changeId, commitId: commit.commitId };
}

function selectionMatchesCommit(selection: RevisionSelection, commit: Commit): boolean {
  if (selection.rev == null) {
    return false;
  }
  if (selection.commitId != null && selection.commitId !== commit.commitId) {
    return false;
  }
  return selection.rev === commit.changeId || selection.rev === commit.commitId;
}

function sameRevisionSelection(left: RevisionSelection, right: RevisionSelection): boolean {
  return left.rev === right.rev && left.commitId === right.commitId;
}

function pageFromURL(url: string): ActivePage {
  let path = url;
  try {
    path = new URL(url, globalThis.location.origin).pathname;
  } catch {
    path = url.split(/[?#]/, 1)[0] ?? url;
  }

  const segment = path.replace(/^\/+/, '').split('/', 1)[0];
  switch (segment) {
    case '':
    case 'revisions':
      return 'revisions';
    case 'bookmarks':
      return 'bookmarks';
    case 'workspaces':
    case 'worktrees':
      return 'workspaces';
    case 'operation-log':
      return 'operation-log';
    case 'files':
      return 'files';
    default:
      return 'other';
  }
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query === '' ? path : `${path}?${query}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
