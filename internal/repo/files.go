package repo

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxRepositoryFileBytes     = 1 << 20
	maxRepositoryListingBytes  = 8 << 20
	repositoryFileListTemplate = `'{"path":' ++ json(path) ++ ',"kind":' ++ json(file_type) ++ ',"conflict":' ++ json(conflict) ++ ',"executable":' ++ json(executable) ++ '}' ++ "\n"`
)

var (
	ErrInvalidRepositoryFilePath = errors.New("invalid repository file path")
	ErrRepositoryFileNotFound    = errors.New("repository file path not found")
	ErrRepositoryListingTooLarge = errors.New("repository directory is too large to list")
)

type jjRepositoryFileEntry struct {
	Path       string             `json:"path"`
	Kind       RepositoryFileKind `json:"kind"`
	Conflict   bool               `json:"conflict"`
	Executable bool               `json:"executable"`
}

func (c *JJClient) RepositoryFiles(
	ctx context.Context,
	opts RequestOptions,
	rev string,
	requestedPath string,
) (RepositoryFilesResult, error) {
	requestedPath, err := cleanRepositoryFilePath(requestedPath)
	if err != nil {
		return RepositoryFilesResult{}, err
	}

	repoPath, err := c.repoPathFor(opts)
	if err != nil {
		return RepositoryFilesResult{}, err
	}
	commit, err := c.resolveReadCommit(ctx, repoPath, rev, opts.CommitID)
	if err != nil {
		return RepositoryFilesResult{}, err
	}

	result := RepositoryFilesResult{
		RepoPath:    repoPath,
		VCS:         "jj",
		Rev:         commit.CommitID,
		Path:        requestedPath,
		Entries:     []RepositoryFileEntry{},
		GeneratedAt: time.Now().UTC(),
	}

	if requestedPath != "" {
		file, found, err := c.repositoryFileEntry(ctx, repoPath, commit.CommitID, requestedPath)
		if err != nil {
			return RepositoryFilesResult{}, err
		}
		if found {
			return c.repositoryFileContent(ctx, repoPath, result, file)
		}
	}

	entries, err := c.repositoryTreeEntries(ctx, repoPath, commit.CommitID, requestedPath)
	if err != nil {
		if requestedPath != "" && strings.Contains(err.Error(), "path is not a single tree in the commit") {
			return RepositoryFilesResult{}, fmt.Errorf("%w: %s", ErrRepositoryFileNotFound, requestedPath)
		}
		return RepositoryFilesResult{}, err
	}

	result.Kind = RepositoryFileKindDirectory
	result.Entries = entries
	return result, nil
}

func (c *JJClient) repositoryFileEntry(
	ctx context.Context,
	repoPath string,
	revision string,
	requestedPath string,
) (jjRepositoryFileEntry, bool, error) {
	output, truncated, err := c.runLimited(
		ctx,
		repoPath,
		maxRepositoryListingBytes,
		"file", "list",
		"--no-pager",
		"--color=never",
		"-r", revision,
		"--template", repositoryFileListTemplate,
		"--", filesetExact(requestedPath),
	)
	if err != nil {
		return jjRepositoryFileEntry{}, false, err
	}
	if truncated {
		return jjRepositoryFileEntry{}, false, ErrRepositoryListingTooLarge
	}

	files, err := decodeJSONLines[jjRepositoryFileEntry](output)
	if err != nil {
		return jjRepositoryFileEntry{}, false, fmt.Errorf("parse jj file list: %w", err)
	}
	if len(files) == 0 {
		return jjRepositoryFileEntry{}, false, nil
	}
	if len(files) != 1 || files[0].Path != requestedPath {
		return jjRepositoryFileEntry{}, false, fmt.Errorf("jj file list returned unexpected results for %q", requestedPath)
	}
	return files[0], true, nil
}

func (c *JJClient) repositoryTreeEntries(
	ctx context.Context,
	repoPath string,
	revision string,
	requestedPath string,
) ([]RepositoryFileEntry, error) {
	// `jj file list` only emits leaf files. Reading the tree object avoids
	// traversing every descendant just to produce one directory listing.
	output, truncated, err := c.runLimited(
		ctx,
		repoPath,
		maxRepositoryListingBytes,
		"debug", "object", "tree",
		"--no-pager",
		"--color=never",
		"-r", revision,
		"--", requestedPath,
	)
	if err != nil {
		return nil, err
	}
	if truncated {
		return nil, ErrRepositoryListingTooLarge
	}

	entries, err := decodeRepositoryTree(output, requestedPath)
	if err != nil {
		return nil, fmt.Errorf("parse jj tree object: %w", err)
	}
	return entries, nil
}

func (c *JJClient) repositoryFileContent(
	ctx context.Context,
	repoPath string,
	result RepositoryFilesResult,
	file jjRepositoryFileEntry,
) (RepositoryFilesResult, error) {
	content, truncated, err := c.runLimited(
		ctx,
		repoPath,
		maxRepositoryFileBytes,
		"file", "show",
		"--no-pager",
		"--color=never",
		"-r", result.Rev,
		filesetExact(file.Path),
	)
	if err != nil {
		return RepositoryFilesResult{}, err
	}

	result.Kind = file.Kind
	result.Conflict = file.Conflict
	result.Executable = file.Executable
	result.MaxBytes = maxRepositoryFileBytes
	result.Truncated = truncated
	result.Binary = bytes.IndexByte(content, 0) >= 0 || !utf8.Valid(content)
	if !result.Binary && !result.Truncated {
		result.Content = string(content)
	}
	return result, nil
}

func cleanRepositoryFilePath(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if strings.IndexByte(value, 0) >= 0 || strings.HasPrefix(value, "/") {
		return "", fmt.Errorf("%w: path must be repository-relative", ErrInvalidRepositoryFilePath)
	}

	cleaned := path.Clean(value)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || cleaned != value {
		return "", fmt.Errorf("%w: path must be normalized", ErrInvalidRepositoryFilePath)
	}
	return cleaned, nil
}

func decodeRepositoryTree(output []byte, requestedPath string) ([]RepositoryFileEntry, error) {
	lines := strings.Split(string(output), "\n")
	entriesLine := -1
	entriesIndent := ""
	for index, line := range lines {
		if strings.TrimSpace(line) == "entries: [" {
			entriesLine = index
			entriesIndent = line[:len(line)-len(strings.TrimLeft(line, " \t"))]
			break
		}
	}
	headerFound := false
	if entriesLine >= 0 {
		for _, line := range lines[:entriesLine] {
			if strings.TrimSpace(line) == "Tree {" {
				headerFound = true
				break
			}
		}
	}
	if !headerFound {
		return nil, errors.New("unexpected tree object header")
	}

	entryIndent := entriesIndent + "    "
	entries := make([]RepositoryFileEntry, 0)
	for index := entriesLine + 1; index < len(lines); index++ {
		if lines[index] != entryIndent+"(" {
			continue
		}
		if index+2 >= len(lines) {
			return nil, errors.New("incomplete tree entry")
		}

		nameJSON := strings.TrimSuffix(strings.TrimSpace(lines[index+1]), ",")
		var name string
		if err := json.Unmarshal([]byte(nameJSON), &name); err != nil {
			return nil, fmt.Errorf("decode tree entry name: %w", err)
		}

		entry := RepositoryFileEntry{Name: name, Path: name}
		if requestedPath != "" {
			entry.Path = requestedPath + "/" + name
		}
		switch value := strings.TrimSpace(lines[index+2]); {
		case strings.HasPrefix(value, "Tree("):
			entry.Kind = RepositoryFileKindDirectory
		case strings.HasPrefix(value, "File {"):
			entry.Kind = RepositoryFileKindFile
		case strings.HasPrefix(value, "Symlink("):
			entry.Kind = RepositoryFileKindSymlink
		case strings.HasPrefix(value, "GitSubmodule("):
			entry.Kind = RepositoryFileKindGitSubmodule
		case strings.HasPrefix(value, "Conflict("):
			entry.Kind = RepositoryFileKindConflict
			entry.Conflict = true
		default:
			return nil, fmt.Errorf("unknown tree entry kind %q", value)
		}

		closed := false
		for index++; index < len(lines); index++ {
			if strings.TrimSpace(lines[index]) == "executable: true," {
				entry.Executable = true
			}
			if lines[index] == entryIndent+")," {
				closed = true
				break
			}
		}
		if !closed {
			return nil, fmt.Errorf("incomplete tree entry %q", name)
		}
		entries = append(entries, entry)
	}

	slices.SortFunc(entries, func(left, right RepositoryFileEntry) int {
		leftDirectory := left.Kind == RepositoryFileKindDirectory
		rightDirectory := right.Kind == RepositoryFileKindDirectory
		if leftDirectory != rightDirectory {
			if leftDirectory {
				return -1
			}
			return 1
		}
		if order := strings.Compare(strings.ToLower(left.Name), strings.ToLower(right.Name)); order != 0 {
			return order
		}
		return strings.Compare(left.Name, right.Name)
	})
	return entries, nil
}
