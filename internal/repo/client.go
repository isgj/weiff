package repo

import (
	"context"
	"time"
)

type Client interface {
	State(ctx context.Context, opts RequestOptions, limit int) (StateResult, error)
	Commit(ctx context.Context, opts RequestOptions, rev string) (CommitResult, error)
	Bookmarks(ctx context.Context, opts RequestOptions) (BookmarksResult, error)
	Remotes(ctx context.Context, opts RequestOptions) (RemotesResult, error)
	Workspaces(ctx context.Context, opts RequestOptions) (WorkspacesResult, error)
	OperationLog(ctx context.Context, opts RequestOptions, limit int) (OperationLogResult, error)
	RestoreOperation(ctx context.Context, opts RequestOptions, operationID string) (CommandResult, error)
	UndoLastOperation(ctx context.Context, opts RequestOptions) (CommandResult, error)
	Diff(ctx context.Context, opts RequestOptions, rev string, ignoreWhitespace bool) (DiffResult, error)
	FileContent(ctx context.Context, opts RequestOptions, rev string, path string) (FileContentResult, error)
	RepositoryFiles(ctx context.Context, opts RequestOptions, rev string, path string) (RepositoryFilesResult, error)
	EvolutionLog(ctx context.Context, opts RequestOptions, rev string, limit int) (EvolutionLogResult, error)
	EvolutionDiff(ctx context.Context, opts RequestOptions, rev string, commitID string) (DiffResult, error)
	Checkout(ctx context.Context, opts RequestOptions, rev string) (CommandResult, error)
	NewFrom(ctx context.Context, opts RequestOptions, rev string) (CommandResult, error)
	Describe(ctx context.Context, opts RequestOptions, rev string, req DescribeRequest) (CommandResult, error)
	Abandon(ctx context.Context, opts RequestOptions, rev string) (CommandResult, error)
	Rebase(ctx context.Context, opts RequestOptions, rev string) (CommandResult, error)
	RestorePaths(ctx context.Context, opts RequestOptions, rev string, paths []string) (CommandResult, error)
	RestoreHunk(ctx context.Context, opts RequestOptions, rev string, req HunkRestoreRequest) (CommandResult, error)
	Fetch(ctx context.Context, opts RequestOptions) (CommandResult, error)
	SetBookmark(ctx context.Context, opts RequestOptions, req BookmarkRequest) (CommandResult, error)
	DeleteBookmark(ctx context.Context, opts RequestOptions, name string) (CommandResult, error)
	PushBookmark(ctx context.Context, opts RequestOptions, req PushBookmarkRequest) (CommandResult, error)
	Tags(ctx context.Context, opts RequestOptions) (TagsResult, error)
	SetTag(ctx context.Context, opts RequestOptions, req TagRequest) (CommandResult, error)
	DeleteTag(ctx context.Context, opts RequestOptions, name string) (CommandResult, error)
	PushTag(ctx context.Context, opts RequestOptions, req PushTagRequest) (CommandResult, error)
	AddWorkspace(ctx context.Context, opts RequestOptions, req WorkspaceRequest) (CommandResult, error)
	ForgetWorkspace(ctx context.Context, opts RequestOptions, name string) (CommandResult, error)
}

type RequestOptions struct {
	RepoPath string `json:"repoPath,omitempty"`
	Revset   string `json:"revset,omitempty"`
	CommitID string `json:"commitId,omitempty"`
}

type HunkRestoreRequest struct {
	Path     string   `json:"path"`
	NewStart int      `json:"newStart"`
	Lines    []string `json:"lines"`
}

type DescribeRequest struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type StateResult struct {
	RepoPath        string     `json:"repoPath"`
	VCS             string     `json:"vcs"`
	CurrentCommitID string     `json:"currentCommitId"`
	Commits         []Commit   `json:"commits"`
	GraphRows       []GraphRow `json:"graphRows"`
	GeneratedAt     time.Time  `json:"generatedAt"`
}

type CommitResult struct {
	RepoPath    string    `json:"repoPath"`
	VCS         string    `json:"vcs"`
	Rev         string    `json:"rev"`
	Commit      Commit    `json:"commit"`
	GeneratedAt time.Time `json:"generatedAt"`
}

type GraphRow struct {
	CommitID string `json:"commitId,omitempty"`
	Graph    string `json:"graph"`
}

type Commit struct {
	CommitID        string   `json:"commitId"`
	ShortCommitID   string   `json:"shortCommitId"`
	ChangeID        string   `json:"changeId"`
	ShortChangeID   string   `json:"shortChangeId"`
	ChangeOffset    *int     `json:"changeOffset,omitempty"`
	Description     string   `json:"description"`
	Summary         string   `json:"summary"`
	AuthorName      string   `json:"authorName"`
	AuthorEmail     string   `json:"authorEmail"`
	AuthorTimestamp string   `json:"authorTimestamp"`
	Current         bool     `json:"current"`
	Empty           bool     `json:"empty"`
	Divergent       bool     `json:"divergent,omitempty"`
	Bookmarks       []string `json:"bookmarks"`
	Tags            []string `json:"tags"`
}

type Bookmark struct {
	Name        string `json:"name"`
	Remote      string `json:"remote,omitempty"`
	Target      string `json:"target,omitempty"`
	ShortTarget string `json:"shortTarget,omitempty"`
	Present     bool   `json:"present"`
	Conflict    bool   `json:"conflict"`
	Tracked     bool   `json:"tracked"`
	Synced      bool   `json:"synced"`
}

type BookmarksResult struct {
	RepoPath    string     `json:"repoPath"`
	VCS         string     `json:"vcs"`
	Bookmarks   []Bookmark `json:"bookmarks"`
	GeneratedAt time.Time  `json:"generatedAt"`
}

type PushBookmarkRequest struct {
	Name     string `json:"name"`
	Remote   string `json:"remote,omitempty"`
	AllowNew bool   `json:"allowNew,omitempty"`
}

type Tag struct {
	Name        string `json:"name"`
	Remote      string `json:"remote,omitempty"`
	Target      string `json:"target,omitempty"`
	ShortTarget string `json:"shortTarget,omitempty"`
	Present     bool   `json:"present"`
	Conflict    bool   `json:"conflict"`
	Tracked     bool   `json:"tracked"`
	Synced      bool   `json:"synced"`
}

type TagsResult struct {
	RepoPath    string    `json:"repoPath"`
	VCS         string    `json:"vcs"`
	Tags        []Tag     `json:"tags"`
	GeneratedAt time.Time `json:"generatedAt"`
}

type TagRequest struct {
	Name      string `json:"name"`
	Rev       string `json:"rev"`
	RepoPath  string `json:"repoPath,omitempty"`
	AllowMove bool   `json:"allowMove"`
}

type PushTagRequest struct {
	Name   string `json:"-"`
	Remote string `json:"remote,omitempty"`
}

type Remote struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type RemotesResult struct {
	RepoPath    string    `json:"repoPath"`
	VCS         string    `json:"vcs"`
	Remotes     []Remote  `json:"remotes"`
	GeneratedAt time.Time `json:"generatedAt"`
}

type Workspace struct {
	Name          string `json:"name"`
	Root          string `json:"root"`
	Target        string `json:"target"`
	ShortTarget   string `json:"shortTarget"`
	ChangeID      string `json:"changeId"`
	ShortChangeID string `json:"shortChangeId"`
	Description   string `json:"description"`
	Summary       string `json:"summary"`
	Current       bool   `json:"current"`
}

type WorkspacesResult struct {
	RepoPath    string      `json:"repoPath"`
	VCS         string      `json:"vcs"`
	Workspaces  []Workspace `json:"workspaces"`
	GeneratedAt time.Time   `json:"generatedAt"`
}

type OperationLogResult struct {
	RepoPath    string           `json:"repoPath"`
	VCS         string           `json:"vcs"`
	Operations  []OperationEntry `json:"operations"`
	Limit       int              `json:"limit"`
	HasMore     bool             `json:"hasMore"`
	GeneratedAt time.Time        `json:"generatedAt"`
}

type OperationEntry struct {
	ID            string   `json:"id"`
	ShortID       string   `json:"shortId"`
	Parents       []string `json:"parents"`
	ShortParents  []string `json:"shortParents"`
	Description   string   `json:"description"`
	User          string   `json:"user"`
	Timestamp     string   `json:"timestamp"`
	Current       bool     `json:"current"`
	Snapshot      bool     `json:"snapshot"`
	WorkspaceName string   `json:"workspaceName"`
	Root          bool     `json:"root"`
	Attributes    string   `json:"attributes"`
}

type DiffResult struct {
	RepoPath    string     `json:"repoPath"`
	VCS         string     `json:"vcs"`
	Rev         string     `json:"rev"`
	Command     []string   `json:"command"`
	Diff        string     `json:"diff"`
	Files       []DiffFile `json:"files"`
	Truncated   bool       `json:"truncated"`
	MaxBytes    int        `json:"maxBytes"`
	GeneratedAt time.Time  `json:"generatedAt"`
}

type DiffFile struct {
	Path       string     `json:"path"`
	Status     string     `json:"status"`
	StatusChar string     `json:"statusChar"`
	Conflict   bool       `json:"conflict"`
	Lines      []DiffLine `json:"lines"`
}

type FileContentResult struct {
	RepoPath    string    `json:"repoPath"`
	Rev         string    `json:"rev"`
	Path        string    `json:"path"`
	Content     string    `json:"content"`
	GeneratedAt time.Time `json:"generatedAt"`
}

type RepositoryFileKind string

const (
	RepositoryFileKindDirectory    RepositoryFileKind = "directory"
	RepositoryFileKindFile         RepositoryFileKind = "file"
	RepositoryFileKindSymlink      RepositoryFileKind = "symlink"
	RepositoryFileKindGitSubmodule RepositoryFileKind = "git-submodule"
	RepositoryFileKindConflict     RepositoryFileKind = "conflict"
)

type RepositoryFileEntry struct {
	Name       string             `json:"name"`
	Path       string             `json:"path"`
	Kind       RepositoryFileKind `json:"kind"`
	Conflict   bool               `json:"conflict,omitempty"`
	Executable bool               `json:"executable,omitempty"`
}

type RepositoryFilesResult struct {
	RepoPath    string                `json:"repoPath"`
	VCS         string                `json:"vcs"`
	Rev         string                `json:"rev"`
	Path        string                `json:"path"`
	Kind        RepositoryFileKind    `json:"kind"`
	Entries     []RepositoryFileEntry `json:"entries"`
	Content     string                `json:"content,omitempty"`
	Binary      bool                  `json:"binary,omitempty"`
	Truncated   bool                  `json:"truncated,omitempty"`
	MaxBytes    int                   `json:"maxBytes,omitempty"`
	Conflict    bool                  `json:"conflict,omitempty"`
	Executable  bool                  `json:"executable,omitempty"`
	GeneratedAt time.Time             `json:"generatedAt"`
}

type DiffLine struct {
	Kind    string `json:"kind"`
	Content string `json:"content"`
}

type EvolutionLogResult struct {
	RepoPath    string           `json:"repoPath"`
	VCS         string           `json:"vcs"`
	Rev         string           `json:"rev"`
	Entries     []EvolutionEntry `json:"entries"`
	GeneratedAt time.Time        `json:"generatedAt"`
}

type EvolutionEntry struct {
	CommitID             string   `json:"commitId"`
	ShortCommitID        string   `json:"shortCommitId"`
	ChangeID             string   `json:"changeId"`
	ShortChangeID        string   `json:"shortChangeId"`
	Description          string   `json:"description"`
	Summary              string   `json:"summary"`
	AuthorName           string   `json:"authorName"`
	AuthorEmail          string   `json:"authorEmail"`
	AuthorTimestamp      string   `json:"authorTimestamp"`
	OperationID          string   `json:"operationId"`
	ShortOperationID     string   `json:"shortOperationId"`
	OperationDescription string   `json:"operationDescription"`
	OperationUser        string   `json:"operationUser"`
	OperationTimestamp   string   `json:"operationTimestamp"`
	Predecessors         []string `json:"predecessors"`
	ShortPredecessors    []string `json:"shortPredecessors"`
	FilesChanged         int      `json:"filesChanged"`
	TotalAdded           int      `json:"totalAdded"`
	TotalRemoved         int      `json:"totalRemoved"`
}

type BookmarkRequest struct {
	Name           string `json:"name"`
	Rev            string `json:"rev"`
	RepoPath       string `json:"repoPath,omitempty"`
	AllowBackwards bool   `json:"allowBackwards"`
}

type WorkspaceRequest struct {
	Destination    string `json:"destination"`
	Name           string `json:"name,omitempty"`
	Rev            string `json:"rev,omitempty"`
	Message        string `json:"message,omitempty"`
	SparsePatterns string `json:"sparsePatterns,omitempty"`
	RepoPath       string `json:"repoPath,omitempty"`
}

type CommandResult struct {
	RepoPath    string    `json:"repoPath"`
	VCS         string    `json:"vcs"`
	Command     []string  `json:"command"`
	Message     string    `json:"message"`
	GeneratedAt time.Time `json:"generatedAt"`
}
