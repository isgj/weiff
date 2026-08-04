package restoretool

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const Command = "__weiff_restore_hunk"

const (
	pathEnvironment    = "WEIFF_RESTORE_HUNK_PATH"
	contentEnvironment = "WEIFF_RESTORE_HUNK_CONTENT"
)

func Environment(path, contentPath string) []string {
	return []string{
		pathEnvironment + "=" + path,
		contentEnvironment + "=" + contentPath,
	}
}

func Run(args []string) (bool, error) {
	if len(args) == 0 || args[0] != Command {
		return false, nil
	}
	if len(args) != 2 {
		return true, fmt.Errorf("%s expects the right-side directory", Command)
	}

	path := strings.TrimSpace(os.Getenv(pathEnvironment))
	if path == "" {
		return true, fmt.Errorf("restore hunk path is missing")
	}
	contentPath := os.Getenv(contentEnvironment)
	if contentPath == "" {
		return true, fmt.Errorf("restore hunk content is missing")
	}
	content, err := os.ReadFile(contentPath)
	if err != nil {
		return true, fmt.Errorf("read restored hunk content: %w", err)
	}

	right, err := os.OpenRoot(args[1])
	if err != nil {
		return true, fmt.Errorf("open restore output: %w", err)
	}
	defer right.Close()

	relativePath := filepath.Clean(filepath.FromSlash(path))
	if filepath.IsAbs(relativePath) || relativePath == "." {
		return true, fmt.Errorf("invalid restore hunk path %q", path)
	}
	if directory := filepath.Dir(relativePath); directory != "." {
		if err := right.MkdirAll(directory, 0o755); err != nil {
			return true, fmt.Errorf("create restore output directory: %w", err)
		}
	}
	if err := right.WriteFile(relativePath, content, 0o600); err != nil {
		return true, fmt.Errorf("write restored hunk: %w", err)
	}
	return true, nil
}
