package repo

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	maxDiffBytes        = 4 << 20
	logTemplate         = `'{"commitId":' ++ json(commit_id) ++ ',"changeId":' ++ json(change_id) ++ ',"changeOffset":' ++ json(self.change_offset()) ++ ',"description":' ++ json(description) ++ ',"authorName":' ++ json(author.name()) ++ ',"authorEmail":' ++ json(author.email()) ++ ',"authorTimestamp":' ++ json(author.timestamp()) ++ ',"current":' ++ json(current_working_copy) ++ ',"empty":' ++ json(empty) ++ ',"divergent":' ++ json(self.divergent()) ++ ',"bookmarks":' ++ json(local_bookmarks.map(|b| b.name())) ++ '}' ++ "\n"`
	bookmarkTemplate    = `'{"name":' ++ json(name) ++ ',"remote":' ++ json(remote) ++ ',"present":' ++ json(present) ++ ',"conflict":' ++ json(conflict) ++ ',"tracked":' ++ json(tracked) ++ ',"synced":' ++ json(synced) ++ ',"target":' ++ if(normal_target, json(normal_target.commit_id()), 'null') ++ '}' ++ "\n"`
	workspaceTemplate   = `'{"name":' ++ json(name) ++ ',"root":' ++ json(root) ++ ',"target":' ++ json(target.commit_id()) ++ ',"changeId":' ++ json(target.change_id()) ++ ',"description":' ++ json(target.description()) ++ '}' ++ "\n"`
	operationTemplate   = `'{"id":' ++ json(id) ++ ',"parents":' ++ json(parents.map(|op| op.id())) ++ ',"description":' ++ json(description) ++ ',"user":' ++ json(user) ++ ',"timestamp":' ++ json(time.start()) ++ ',"current":' ++ json(current_operation) ++ ',"snapshot":' ++ json(snapshot) ++ ',"workspaceName":' ++ json(workspace_name) ++ ',"root":' ++ json(root) ++ ',"attributes":' ++ json(attributes) ++ '}' ++ "\n"`
	diffSummaryTemplate = `'{"path":' ++ json(display_diff_path) ++ ',"status":' ++ json(status) ++ ',"statusChar":' ++ json(status_char) ++ '}' ++ "\n"`
	evolutionTemplate   = `'{"commitId":' ++ json(self.commit().commit_id()) ++ ',"changeId":' ++ json(self.commit().change_id()) ++ ',"description":' ++ json(self.commit().description()) ++ ',"authorName":' ++ json(self.commit().author().name()) ++ ',"authorEmail":' ++ json(self.commit().author().email()) ++ ',"authorTimestamp":' ++ json(self.commit().author().timestamp()) ++ ',"operationId":' ++ json(self.operation().id()) ++ ',"operationDescription":' ++ json(self.operation().description()) ++ ',"operationUser":' ++ json(self.operation().user()) ++ ',"operationTimestamp":' ++ json(self.operation().time().start()) ++ ',"predecessors":' ++ json(self.predecessors().map(|c| c.commit_id())) ++ ',"filesChanged":' ++ json(self.inter_diff().stat().files().len()) ++ ',"totalAdded":' ++ json(self.inter_diff().stat().total_added()) ++ ',"totalRemoved":' ++ json(self.inter_diff().stat().total_removed()) ++ '}' ++ "\n"`
)

type JJClient struct {
	repoPath         string
	repoPathResolver func() (string, error)
	executable       string
	restoreTool      string
}

func NewJJClient(repoPath string) *JJClient {
	return &JJClient{
		repoPath:   repoPath,
		executable: "jj",
	}
}

func NewJJClientWithRepoPathResolver(resolve func() (string, error)) *JJClient {
	return &JJClient{
		repoPathResolver: resolve,
		executable:       "jj",
	}
}

func (c *JJClient) State(ctx context.Context, opts RequestOptions, limit int) (StateResult, error) {
	if limit <= 0 {
		limit = 50
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return StateResult{}, err
	}

	logArgs := []string{
		"log",
		"--no-pager",
		"--color=never",
		"--limit",
		fmt.Sprint(limit),
	}
	if revset := strings.TrimSpace(opts.Revset); revset != "" {
		logArgs = append(logArgs, "--revision", revset)
	}
	logArgs = append(
		logArgs,
		"--template",
		logTemplate,
	)
	logOutput, err := c.run(ctx, repoPath, logArgs...)
	if err != nil {
		return StateResult{}, err
	}

	commits, graphRows, err := decodeGraphLog(logOutput)
	if err != nil {
		return StateResult{}, fmt.Errorf("parse jj log: %w", err)
	}
	enrichCommits(commits)

	result := StateResult{
		RepoPath:    repoPath,
		VCS:         "jj",
		Commits:     nonNilSlice(commits),
		GraphRows:   nonNilSlice(graphRows),
		GeneratedAt: time.Now().UTC(),
	}
	if current := slices.IndexFunc(commits, func(commit Commit) bool { return commit.Current }); current >= 0 {
		result.CurrentCommitID = commits[current].CommitID
	}

	return result, nil
}

func (c *JJClient) Commit(ctx context.Context, opts RequestOptions, rev string) (CommitResult, error) {
	rev = defaultRevision(rev)
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommitResult{}, err
	}
	commit, err := c.resolveReadCommit(ctx, repoPath, rev, opts.CommitID)
	if err != nil {
		return CommitResult{}, err
	}

	return CommitResult{
		RepoPath:    repoPath,
		VCS:         "jj",
		Rev:         commit.CommitID,
		Commit:      commit,
		GeneratedAt: time.Now().UTC(),
	}, nil
}

func (c *JJClient) Bookmarks(ctx context.Context, opts RequestOptions) (BookmarksResult, error) {
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return BookmarksResult{}, err
	}

	bookmarks, err := c.listBookmarks(ctx, repoPath)
	if err != nil {
		return BookmarksResult{}, err
	}

	return BookmarksResult{
		RepoPath:    repoPath,
		VCS:         "jj",
		Bookmarks:   nonNilSlice(bookmarks),
		GeneratedAt: time.Now().UTC(),
	}, nil
}

func (c *JJClient) Remotes(ctx context.Context, opts RequestOptions) (RemotesResult, error) {
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return RemotesResult{}, err
	}

	output, err := c.run(ctx, repoPath, "git", "remote", "list", "--no-pager", "--color=never")
	if err != nil {
		return RemotesResult{}, err
	}

	remotes := []Remote{}
	for line := range strings.Lines(string(output)) {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		name, url, _ := strings.Cut(line, " ")
		remotes = append(remotes, Remote{Name: name, URL: url})
	}

	return RemotesResult{
		RepoPath:    repoPath,
		VCS:         "jj",
		Remotes:     remotes,
		GeneratedAt: time.Now().UTC(),
	}, nil
}

func (c *JJClient) Workspaces(ctx context.Context, opts RequestOptions) (WorkspacesResult, error) {
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return WorkspacesResult{}, err
	}

	workspaces, err := c.listWorkspaces(ctx, repoPath)
	if err != nil {
		return WorkspacesResult{}, err
	}

	return WorkspacesResult{
		RepoPath:    repoPath,
		VCS:         "jj",
		Workspaces:  nonNilSlice(workspaces),
		GeneratedAt: time.Now().UTC(),
	}, nil
}

func (c *JJClient) OperationLog(ctx context.Context, opts RequestOptions, limit int) (OperationLogResult, error) {
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return OperationLogResult{}, err
	}

	args := []string{
		"op",
		"log",
		"--no-pager",
		"--color=never",
		"-G",
	}
	fetchLimit := limit
	if limit > 0 {
		fetchLimit++
		args = append(args, "--limit", fmt.Sprint(fetchLimit))
	}
	args = append(args, "--template", operationTemplate)
	output, err := c.run(ctx, repoPath, args...)
	if err != nil {
		return OperationLogResult{}, err
	}

	operations, err := decodeJSONLines[OperationEntry](output)
	if err != nil {
		return OperationLogResult{}, fmt.Errorf("parse jj op log: %w", err)
	}
	enrichOperations(operations)
	hasMore := limit > 0 && len(operations) > limit
	if hasMore {
		operations = operations[:limit]
	}

	return OperationLogResult{
		RepoPath:    repoPath,
		VCS:         "jj",
		Operations:  nonNilSlice(operations),
		Limit:       limit,
		HasMore:     hasMore,
		GeneratedAt: time.Now().UTC(),
	}, nil
}

func (c *JJClient) listBookmarks(ctx context.Context, repoPath string) ([]Bookmark, error) {
	bookmarkArgs := []string{
		"bookmark",
		"list",
		"--all-remotes",
		"--no-pager",
		"--color=never",
		"--template",
		bookmarkTemplate,
	}
	bookmarkOutput, err := c.run(ctx, repoPath, bookmarkArgs...)
	if err != nil {
		return nil, err
	}

	bookmarks, err := decodeJSONLines[Bookmark](bookmarkOutput)
	if err != nil {
		return nil, fmt.Errorf("parse jj bookmark list: %w", err)
	}
	for i := range bookmarks {
		bookmarks[i].ShortTarget = shortID(bookmarks[i].Target)
	}

	return bookmarks, nil
}

func (c *JJClient) listWorkspaces(ctx context.Context, repoPath string) ([]Workspace, error) {
	workspaceArgs := []string{
		"workspace",
		"list",
		"--no-pager",
		"--color=never",
		"--template",
		workspaceTemplate,
	}
	workspaceOutput, err := c.run(ctx, repoPath, workspaceArgs...)
	if err != nil {
		return nil, err
	}

	workspaces, err := decodeJSONLines[Workspace](workspaceOutput)
	if err != nil {
		return nil, fmt.Errorf("parse jj workspace list: %w", err)
	}
	for i := range workspaces {
		workspaces[i].ShortTarget = shortID(workspaces[i].Target)
		workspaces[i].ShortChangeID = shortID(workspaces[i].ChangeID)
		workspaces[i].Summary = firstLineOrDefault(workspaces[i].Description, "(no description set)")
		workspaces[i].Current = pathContains(workspaces[i].Root, repoPath)
	}

	return workspaces, nil
}

func decodeGraphLog(data []byte) ([]Commit, []GraphRow, error) {
	commits := make([]Commit, 0)
	graphRows := make([]GraphRow, 0)

	for line := range strings.Lines(string(data)) {
		line = strings.TrimSuffix(line, "\n")
		if strings.TrimSpace(line) == "" {
			continue
		}

		jsonStart := strings.Index(line, "{")
		if jsonStart < 0 {
			graphRows = append(graphRows, GraphRow{Graph: strings.TrimRight(line, " ")})
			continue
		}

		var commit Commit
		if err := json.Unmarshal([]byte(line[jsonStart:]), &commit); err != nil {
			return nil, nil, err
		}

		commits = append(commits, commit)
		graphRows = append(graphRows, GraphRow{
			CommitID: commit.CommitID,
			Graph:    strings.TrimRight(line[:jsonStart], " "),
		})
	}

	return commits, graphRows, nil
}

func (c *JJClient) Diff(ctx context.Context, opts RequestOptions, rev string, ignoreWhitespace bool) (DiffResult, error) {
	rev = defaultRevision(rev)
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return DiffResult{}, err
	}
	commit, err := c.resolveReadCommit(ctx, repoPath, rev, opts.CommitID)
	if err != nil {
		return DiffResult{}, err
	}
	rev = commit.CommitID

	args := []string{"diff", "--git", "--no-pager", "--color=never", "-r", rev}
	if ignoreWhitespace {
		args = append(args, "--ignore-all-space")
	}
	result := DiffResult{
		RepoPath:    repoPath,
		VCS:         "jj",
		Rev:         rev,
		Command:     append([]string{c.executable}, args...),
		MaxBytes:    maxDiffBytes,
		GeneratedAt: time.Now().UTC(),
	}

	diffOutput, truncated, err := c.runLimited(ctx, repoPath, maxDiffBytes, args...)
	if err != nil {
		return result, err
	}
	result.Diff = string(diffOutput)
	result.Truncated = truncated

	summaryArgs := []string{
		"diff",
		"--no-pager",
		"--color=never",
		"-r",
		rev,
		"--template",
		diffSummaryTemplate,
	}
	summaryOutput, err := c.run(ctx, repoPath, summaryArgs...)
	if err != nil {
		return result, err
	}

	summary, err := decodeJSONLines[DiffFile](summaryOutput)
	if err != nil {
		return result, fmt.Errorf("parse jj diff summary: %w", err)
	}

	typeArgs := []string{
		"diff",
		"--types",
		"--no-pager",
		"--color=never",
		"-r",
		rev,
	}
	typeOutput, err := c.run(ctx, repoPath, typeArgs...)
	if err != nil {
		return result, err
	}
	markConflictedFiles(summary, parseDiffTypes(typeOutput))

	result.Files = ParseGitDiff(result.Diff, summary)
	result.Files = nonNilSlice(result.Files)

	return result, nil
}

func (c *JJClient) FileContent(ctx context.Context, opts RequestOptions, rev string, path string) (FileContentResult, error) {
	rev = defaultRevision(rev)
	path = strings.TrimSpace(path)
	if path == "" {
		return FileContentResult{}, fmt.Errorf("file path is required")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return FileContentResult{}, err
	}
	commit, err := c.resolveReadCommit(ctx, repoPath, rev, opts.CommitID)
	if err != nil {
		return FileContentResult{}, err
	}
	rev = commit.CommitID

	content, err := c.run(ctx, repoPath, "file", "show", "--no-pager", "--color=never", "-r", rev, filesetExact(path))
	if err != nil {
		return FileContentResult{}, err
	}

	return FileContentResult{
		RepoPath:    repoPath,
		Rev:         rev,
		Path:        path,
		Content:     string(content),
		GeneratedAt: time.Now().UTC(),
	}, nil
}

func (c *JJClient) EvolutionLog(ctx context.Context, opts RequestOptions, rev string, limit int) (EvolutionLogResult, error) {
	rev = defaultRevision(rev)
	if limit <= 0 {
		limit = 30
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return EvolutionLogResult{}, err
	}
	commit, err := c.resolveReadCommit(ctx, repoPath, rev, opts.CommitID)
	if err != nil {
		return EvolutionLogResult{}, err
	}
	rev = commit.CommitID

	args := []string{
		"evolog",
		"--no-pager",
		"--color=never",
		"-G",
		"-r",
		rev,
		"--limit",
		fmt.Sprint(limit),
		"--template",
		evolutionTemplate,
	}
	output, err := c.run(ctx, repoPath, args...)
	if err != nil {
		return EvolutionLogResult{}, err
	}

	entries, err := decodePrefixedJSONLines[EvolutionEntry](output)
	if err != nil {
		return EvolutionLogResult{}, fmt.Errorf("parse jj evolog: %w", err)
	}
	for i := range entries {
		entries[i].Predecessors = nonNilSlice(entries[i].Predecessors)
		entries[i].ShortPredecessors = shortIDs(entries[i].Predecessors)
		entries[i].ShortCommitID = shortID(entries[i].CommitID)
		entries[i].ShortChangeID = shortID(entries[i].ChangeID)
		entries[i].ShortOperationID = shortID(entries[i].OperationID)
		entries[i].Summary = firstLineOrDefault(entries[i].Description, "(no description set)")
	}

	return EvolutionLogResult{
		RepoPath:    repoPath,
		VCS:         "jj",
		Rev:         rev,
		Entries:     nonNilSlice(entries),
		GeneratedAt: time.Now().UTC(),
	}, nil
}

func (c *JJClient) EvolutionDiff(ctx context.Context, opts RequestOptions, rev string, commitID string) (DiffResult, error) {
	rev = strings.TrimSpace(rev)
	if rev == "" {
		rev = "@"
	}
	commitID = strings.TrimSpace(commitID)
	if commitID == "" {
		return DiffResult{}, fmt.Errorf("evolution commit id is required")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return DiffResult{}, err
	}

	args := []string{
		"evolog",
		"--no-pager",
		"--color=never",
		"-G",
		"-r",
		rev,
		"--template",
		evolutionDiffTemplate(commitID),
	}
	result := DiffResult{
		RepoPath:    repoPath,
		VCS:         "jj",
		Rev:         commitID,
		Command:     append([]string{c.executable}, args...),
		MaxBytes:    maxDiffBytes,
		GeneratedAt: time.Now().UTC(),
	}

	diffOutput, truncated, err := c.runLimited(ctx, repoPath, maxDiffBytes, args...)
	if err != nil {
		return result, err
	}
	result.Diff = string(diffOutput)
	result.Truncated = truncated
	if !truncated {
		result.Files = ParseGitDiff(result.Diff, nil)
	}
	result.Files = nonNilSlice(result.Files)

	return result, nil
}

func (c *JJClient) commandResult(ctx context.Context, repoPath string, args ...string) (CommandResult, error) {
	return c.commandResultWithEnv(ctx, repoPath, nil, args...)
}

func (c *JJClient) commandResultWithEnv(ctx context.Context, repoPath string, environment []string, args ...string) (CommandResult, error) {
	output, _, err := c.runLimitedWithEnv(ctx, repoPath, 0, environment, args...)
	result := CommandResult{
		RepoPath:    repoPath,
		VCS:         "jj",
		Command:     append([]string{c.executable}, args...),
		Message:     strings.TrimSpace(string(output)),
		GeneratedAt: time.Now().UTC(),
	}
	if err != nil {
		return result, err
	}
	return result, nil
}

func (c *JJClient) run(ctx context.Context, repoPath string, args ...string) ([]byte, error) {
	output, _, err := c.runLimitedWithEnv(ctx, repoPath, 0, nil, args...)
	return output, err
}

func (c *JJClient) runLimited(ctx context.Context, repoPath string, limit int, args ...string) ([]byte, bool, error) {
	return c.runLimitedWithEnv(ctx, repoPath, limit, nil, args...)
}

func (c *JJClient) runLimitedWithEnv(ctx context.Context, repoPath string, limit int, environment []string, args ...string) ([]byte, bool, error) {
	cmd := exec.CommandContext(ctx, c.executable, args...)
	cmd.Dir = repoPath
	if len(environment) > 0 {
		cmd.Env = os.Environ()
		for _, setting := range environment {
			name, _, ok := strings.Cut(setting, "=")
			if !ok || name == "" {
				continue
			}
			prefix := name + "="
			cmd.Env = slices.DeleteFunc(cmd.Env, func(existing string) bool {
				return strings.HasPrefix(existing, prefix)
			})
			cmd.Env = append(cmd.Env, setting)
		}
	}

	stdout := boundedBuffer{limit: limit}
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			return stdout.Bytes(), stdout.Truncated(), fmt.Errorf("run %s: %w", strings.Join(append([]string{c.executable}, args...), " "), err)
		}
		return stdout.Bytes(), stdout.Truncated(), fmt.Errorf("run %s: %s: %w", strings.Join(append([]string{c.executable}, args...), " "), message, err)
	}

	return stdout.Bytes(), stdout.Truncated(), nil
}

func defaultRevision(rev string) string {
	rev = strings.TrimSpace(rev)
	if rev == "" {
		return "@"
	}
	return rev
}

func (c *JJClient) resolveReadCommit(ctx context.Context, repoPath string, rev string, commitID string) (Commit, error) {
	rev = defaultRevision(rev)
	commitID = strings.TrimSpace(commitID)

	commit, err := c.readSingleCommit(ctx, repoPath, rev)
	if err == nil {
		return commit, nil
	}

	if commitID == "" || commitID == rev {
		return Commit{}, fmt.Errorf("resolve revision %q: %w", rev, err)
	}

	fallback, fallbackErr := c.readSingleCommit(ctx, repoPath, commitID)
	if fallbackErr != nil {
		return Commit{}, fmt.Errorf("resolve revision %q: %w; commit id fallback %q failed: %v", rev, err, commitID, fallbackErr)
	}
	if !revisionMatchesCommit(rev, fallback) {
		return Commit{}, fmt.Errorf("commit id fallback %q belongs to change %q, not requested revision %q", commitID, fallback.ChangeID, rev)
	}
	return fallback, nil
}

func (c *JJClient) readSingleCommit(ctx context.Context, repoPath string, rev string) (Commit, error) {
	output, err := c.run(
		ctx,
		repoPath,
		"log",
		"--no-pager",
		"--color=never",
		"--limit",
		"1",
		"--revision",
		rev,
		"--template",
		logTemplate,
	)
	if err != nil {
		return Commit{}, err
	}

	commits, _, err := decodeGraphLog(output)
	if err != nil {
		return Commit{}, fmt.Errorf("parse jj commit: %w", err)
	}
	if len(commits) == 0 {
		return Commit{}, fmt.Errorf("revision %q not found", rev)
	}
	enrichCommits(commits)
	return commits[0], nil
}

func revisionMatchesCommit(rev string, commit Commit) bool {
	rev = strings.TrimSpace(rev)
	if base, _, ok := strings.Cut(rev, "/"); ok {
		rev = base
	}
	if rev == "" || rev == "@" {
		return true
	}

	return strings.HasPrefix(commit.CommitID, rev) || strings.HasPrefix(commit.ChangeID, rev)
}

func (c *JJClient) repoPathFor(opts RequestOptions) (string, error) {
	repoPath := strings.TrimSpace(opts.RepoPath)
	if repoPath == "" {
		repoPath = strings.TrimSpace(c.repoPath)
		if c.repoPathResolver != nil {
			configured, err := c.repoPathResolver()
			if err != nil {
				return "", fmt.Errorf("resolve configured repository: %w", err)
			}
			repoPath = strings.TrimSpace(configured)
		}
	}
	if repoPath == "" {
		return "", fmt.Errorf("repository path is required")
	}

	absolute, err := filepath.Abs(repoPath)
	if err != nil {
		return "", fmt.Errorf("resolve repo path: %w", err)
	}
	return absolute, nil
}

func decodeJSONLines[T any](data []byte) ([]T, error) {
	values := make([]T, 0)
	for line := range strings.Lines(string(data)) {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var value T
		if err := json.Unmarshal([]byte(line), &value); err != nil {
			return nil, err
		}
		values = append(values, value)
	}

	return values, nil
}

func decodePrefixedJSONLines[T any](data []byte) ([]T, error) {
	values := make([]T, 0)
	for line := range strings.Lines(string(data)) {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		jsonStart := strings.Index(line, "{")
		if jsonStart < 0 {
			continue
		}

		var value T
		if err := json.Unmarshal([]byte(line[jsonStart:]), &value); err != nil {
			return nil, err
		}
		values = append(values, value)
	}

	return values, nil
}

func parseDiffTypes(data []byte) map[string]bool {
	conflicts := make(map[string]bool)
	for line := range strings.Lines(string(data)) {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		types, path, ok := strings.Cut(line, " ")
		if !ok {
			continue
		}
		if strings.Contains(types, "C") {
			conflicts[strings.TrimSpace(path)] = true
		}
	}
	return conflicts
}

func markConflictedFiles(files []DiffFile, conflicts map[string]bool) {
	if len(conflicts) == 0 {
		return
	}
	for i := range files {
		files[i].Conflict = files[i].Conflict || conflicts[files[i].Path]
	}
}

func enrichCommits(commits []Commit) {
	changeCounts := make(map[string]int, len(commits))
	for _, commit := range commits {
		if commit.ChangeID != "" {
			changeCounts[commit.ChangeID]++
		}
	}

	for i := range commits {
		commits[i].Bookmarks = nonNilSlice(commits[i].Bookmarks)
		commits[i].ShortCommitID = shortID(commits[i].CommitID)
		commits[i].ShortChangeID = shortID(commits[i].ChangeID)
		commits[i].Summary = firstLineOrDefault(commits[i].Description, "(no description set)")
		if count := changeCounts[commits[i].ChangeID]; count > 1 {
			commits[i].Divergent = true
		}
	}
}

func enrichOperations(operations []OperationEntry) {
	for i := range operations {
		operations[i].Parents = nonNilSlice(operations[i].Parents)
		operations[i].ShortParents = shortIDs(operations[i].Parents)
		operations[i].ShortID = shortID(operations[i].ID)
		if strings.TrimSpace(operations[i].Description) == "" {
			operations[i].Description = "(no description set)"
		}
	}
}

func nonNilSlice[T any](values []T) []T {
	if values == nil {
		return []T{}
	}
	return values
}

func shortID(id string) string {
	if len(id) <= 12 {
		return id
	}
	return id[:12]
}

func shortIDs(ids []string) []string {
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		result = append(result, shortID(id))
	}
	return result
}

func pathContains(root string, target string) bool {
	root = filepath.Clean(root)
	target = filepath.Clean(target)
	relative, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)))
}

func evolutionDiffTemplate(commitID string) string {
	return "if(stringify(self.commit().commit_id()) == " + strconv.Quote(commitID) + ", self.inter_diff().git(), \"\")"
}

func firstLineOrDefault(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	for line := range strings.Lines(value) {
		line = strings.TrimSpace(line)
		if line != "" {
			return line
		}
	}
	return fallback
}
