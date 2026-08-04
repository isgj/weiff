package repo

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"weiff/internal/restoretool"
)

func (c *JJClient) RestorePaths(ctx context.Context, opts RequestOptions, rev string, paths []string) (CommandResult, error) {
	rev = strings.TrimSpace(rev)
	if rev == "" {
		return CommandResult{}, fmt.Errorf("revision is required")
	}
	filesets := make([]string, 0, len(paths))
	for _, path := range paths {
		if path = strings.TrimSpace(path); path != "" {
			filesets = append(filesets, filesetExact(path))
		}
	}
	if len(filesets) == 0 {
		return CommandResult{}, fmt.Errorf("at least one path is required")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	args := append([]string{"restore", "--changes-in", rev}, filesets...)
	return c.commandResult(ctx, repoPath, args...)
}

func (c *JJClient) RestoreHunk(ctx context.Context, opts RequestOptions, rev string, req HunkRestoreRequest) (CommandResult, error) {
	rev = strings.TrimSpace(rev)
	if rev == "" {
		return CommandResult{}, fmt.Errorf("revision is required")
	}
	path := strings.TrimSpace(req.Path)
	if path == "" {
		return CommandResult{}, fmt.Errorf("file path is required")
	}
	if len(req.Lines) == 0 {
		return CommandResult{}, fmt.Errorf("hunk lines are required")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	current, err := c.run(ctx, repoPath, "file", "show", "--no-pager", "--color=never", "-r", rev, filesetExact(path))
	if err != nil {
		return CommandResult{}, err
	}

	restored, err := reverseHunk(string(current), req)
	if err != nil {
		return CommandResult{}, err
	}

	contentPath, cleanup, err := writeRestoreHunkContent(restored)
	if err != nil {
		return CommandResult{}, err
	}
	defer cleanup()

	toolExecutable := c.restoreTool
	if toolExecutable == "" {
		toolExecutable, err = os.Executable()
		if err != nil {
			return CommandResult{}, fmt.Errorf("resolve weiff executable: %w", err)
		}
	}
	toolName := "weiff-restore-hunk"
	args := []string{
		"--config",
		"merge-tools." + toolName + ".program=" + strconv.Quote(toolExecutable),
		"--config",
		"merge-tools." + toolName + `.diff-args=["` + restoretool.Command + `","$right"]`,
		"restore",
		"--changes-in",
		rev,
		"--tool",
		toolName,
		filesetExact(path),
	}
	return c.commandResultWithEnv(
		ctx,
		repoPath,
		restoretool.Environment(path, contentPath),
		args...,
	)
}

// reverseHunk removes a single diff hunk from the current file content,
// producing the content the file should have after the hunk is restored.
func reverseHunk(current string, req HunkRestoreRequest) (string, error) {
	newSide := make([]string, 0, len(req.Lines))
	oldSide := make([]string, 0, len(req.Lines))
	for _, line := range req.Lines {
		if line == "" {
			newSide = append(newSide, "")
			oldSide = append(oldSide, "")
			continue
		}
		content := line[1:]
		switch line[0] {
		case ' ':
			newSide = append(newSide, content)
			oldSide = append(oldSide, content)
		case '+':
			newSide = append(newSide, content)
		case '-':
			oldSide = append(oldSide, content)
		case '\\':
			// "\\ No newline at end of file" marker; ignore.
		default:
			return "", fmt.Errorf("invalid hunk line %q", line)
		}
	}

	hadTrailingNewline := current == "" || strings.HasSuffix(current, "\n")
	var currentLines []string
	if current != "" {
		currentLines = strings.Split(strings.TrimSuffix(current, "\n"), "\n")
	}

	start := req.NewStart - 1
	if len(newSide) == 0 {
		// A hunk with an empty new side inserts after the reported line.
		start = req.NewStart
	}
	if start < 0 || start+len(newSide) > len(currentLines) {
		return "", fmt.Errorf("hunk is out of range for %s", req.Path)
	}
	for i, line := range newSide {
		if currentLines[start+i] != line {
			return "", fmt.Errorf("hunk does not match the current content of %s", req.Path)
		}
	}

	restoredLines := slices.Concat(currentLines[:start], oldSide, currentLines[start+len(newSide):])
	restored := strings.Join(restoredLines, "\n")
	if len(restoredLines) > 0 && hadTrailingNewline {
		restored += "\n"
	}
	return restored, nil
}

func writeRestoreHunkContent(restored string) (string, func(), error) {
	dir, err := os.MkdirTemp("", "weiff-restore-hunk-")
	if err != nil {
		return "", nil, fmt.Errorf("create restore tool dir: %w", err)
	}
	cleanup := func() { _ = os.RemoveAll(dir) }

	contentPath := filepath.Join(dir, "content")
	if err := os.WriteFile(contentPath, []byte(restored), 0o600); err != nil {
		cleanup()
		return "", nil, fmt.Errorf("write restored content: %w", err)
	}

	return contentPath, cleanup, nil
}

// filesetExact quotes a repo-relative path as an exact jj fileset pattern.
func filesetExact(path string) string {
	escaped := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(path)
	return `file:"` + escaped + `"`
}

func (c *JJClient) RestoreOperation(ctx context.Context, opts RequestOptions, operationID string) (CommandResult, error) {
	operationID = strings.TrimSpace(operationID)
	if operationID == "" {
		return CommandResult{}, fmt.Errorf("operation id is required")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	return c.commandResult(ctx, repoPath, "op", "restore", operationID)
}

func (c *JJClient) UndoLastOperation(ctx context.Context, opts RequestOptions) (CommandResult, error) {
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	return c.commandResult(ctx, repoPath, "undo")
}

func (c *JJClient) Checkout(ctx context.Context, opts RequestOptions, rev string) (CommandResult, error) {
	rev = strings.TrimSpace(rev)
	if rev == "" {
		return CommandResult{}, fmt.Errorf("revision is required")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	return c.commandResult(ctx, repoPath, "edit", rev)
}

func (c *JJClient) NewFrom(ctx context.Context, opts RequestOptions, rev string) (CommandResult, error) {
	rev = strings.TrimSpace(rev)
	if rev == "" {
		return CommandResult{}, fmt.Errorf("revision is required")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	return c.commandResult(ctx, repoPath, "new", rev)
}

func (c *JJClient) Describe(ctx context.Context, opts RequestOptions, rev string, req DescribeRequest) (CommandResult, error) {
	rev = strings.TrimSpace(rev)
	if rev == "" {
		return CommandResult{}, fmt.Errorf("revision is required")
	}
	title := strings.TrimSpace(req.Title)
	body := strings.TrimRight(req.Body, "\n")
	if title == "" && strings.TrimSpace(body) != "" {
		return CommandResult{}, fmt.Errorf("title is required when a body is provided")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	message := title
	if strings.TrimSpace(body) != "" {
		message = title + "\n\n" + body
	}

	return c.commandResult(ctx, repoPath, "describe", "-r", rev, "-m", message)
}

func (c *JJClient) Abandon(ctx context.Context, opts RequestOptions, rev string) (CommandResult, error) {
	rev = strings.TrimSpace(rev)
	if rev == "" {
		return CommandResult{}, fmt.Errorf("revision is required")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	return c.commandResult(ctx, repoPath, "abandon", rev)
}

func (c *JJClient) Rebase(ctx context.Context, opts RequestOptions, rev string) (CommandResult, error) {
	rev = strings.TrimSpace(rev)
	if rev == "" {
		return CommandResult{}, fmt.Errorf("revision is required")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	return c.commandResult(ctx, repoPath, "rebase", "-s", rev, "-d", "trunk()")
}

func (c *JJClient) Fetch(ctx context.Context, opts RequestOptions) (CommandResult, error) {
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	return c.commandResult(ctx, repoPath, "git", "fetch")
}

func (c *JJClient) SetBookmark(ctx context.Context, opts RequestOptions, req BookmarkRequest) (CommandResult, error) {
	name := strings.TrimSpace(req.Name)
	rev := strings.TrimSpace(req.Rev)
	if name == "" {
		return CommandResult{}, fmt.Errorf("bookmark name is required")
	}
	if rev == "" {
		rev = "@"
	}

	args := []string{"bookmark", "set", name, "--revision", rev}
	if req.AllowBackwards {
		args = append(args, "--allow-backwards")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	return c.commandResult(ctx, repoPath, args...)
}

func (c *JJClient) DeleteBookmark(ctx context.Context, opts RequestOptions, name string) (CommandResult, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return CommandResult{}, fmt.Errorf("bookmark name is required")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	return c.commandResult(ctx, repoPath, "bookmark", "delete", name)
}

func (c *JJClient) PushBookmark(ctx context.Context, opts RequestOptions, req PushBookmarkRequest) (CommandResult, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return CommandResult{}, fmt.Errorf("bookmark name is required")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	args := []string{"git", "push", "-b", name}
	if remote := strings.TrimSpace(req.Remote); remote != "" {
		args = append(args, "--remote", remote)
	}
	if req.AllowNew {
		args = append(args, "--allow-new")
	}

	return c.commandResult(ctx, repoPath, args...)
}

func (c *JJClient) AddWorkspace(ctx context.Context, opts RequestOptions, req WorkspaceRequest) (CommandResult, error) {
	destination := strings.TrimSpace(req.Destination)
	if destination == "" {
		return CommandResult{}, fmt.Errorf("workspace destination is required")
	}
	destination, err := expandHomePath(destination)
	if err != nil {
		return CommandResult{}, fmt.Errorf("workspace destination: %w", err)
	}

	args := []string{"workspace", "add"}
	if name := strings.TrimSpace(req.Name); name != "" {
		args = append(args, "--name", name)
	}
	if rev := strings.TrimSpace(req.Rev); rev != "" {
		args = append(args, "--revision", rev)
	}
	if message := strings.TrimSpace(req.Message); message != "" {
		args = append(args, "--message", message)
	}
	if sparsePatterns := strings.TrimSpace(req.SparsePatterns); sparsePatterns != "" {
		if !slices.Contains([]string{"copy", "full", "empty"}, sparsePatterns) {
			return CommandResult{}, fmt.Errorf("workspace sparse patterns must be copy, full, or empty")
		}
		args = append(args, "--sparse-patterns", sparsePatterns)
	}
	args = append(args, destination)

	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	return c.commandResult(ctx, repoPath, args...)
}

func (c *JJClient) ForgetWorkspace(ctx context.Context, opts RequestOptions, name string) (CommandResult, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return CommandResult{}, fmt.Errorf("workspace name is required")
	}
	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return CommandResult{}, err
	}

	return c.commandResult(ctx, repoPath, "workspace", "forget", name)
}

func expandHomePath(path string) (string, error) {
	if path == "~" {
		return os.UserHomeDir()
	}
	if after, ok := strings.CutPrefix(path, "~/"); ok {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, filepath.FromSlash(after)), nil
	}
	if after, ok := strings.CutPrefix(path, `~\`); ok {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, after), nil
	}
	return path, nil
}
