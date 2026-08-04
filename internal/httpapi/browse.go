package httpapi

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type browseDirEntry struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	IsRepo bool   `json:"isRepo"`
}

type browseDirsResult struct {
	Path   string           `json:"path"`
	Parent string           `json:"parent"`
	IsRepo bool             `json:"isRepo"`
	Dirs   []browseDirEntry `json:"dirs"`
}

func (s *Server) handleBrowseDirs(w http.ResponseWriter, r *http.Request) {
	requested := strings.TrimSpace(r.URL.Query().Get("path"))
	if requested == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "resolve home directory: " + err.Error()})
			return
		}
		requested = home
	}

	absolute, err := filepath.Abs(expandHome(requested))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "resolve path: " + err.Error()})
		return
	}

	entries, err := os.ReadDir(absolute)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrPermission) {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, errorResponse{Error: err.Error()})
		return
	}

	dirs := make([]browseDirEntry, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		childPath := filepath.Join(absolute, entry.Name())
		dirs = append(dirs, browseDirEntry{
			Name:   entry.Name(),
			Path:   childPath,
			IsRepo: isJJRepo(childPath),
		})
	}
	sort.Slice(dirs, func(i, j int) bool {
		return strings.ToLower(dirs[i].Name) < strings.ToLower(dirs[j].Name)
	})

	parent := filepath.Dir(absolute)
	if parent == absolute {
		parent = ""
	}

	writeJSON(w, http.StatusOK, browseDirsResult{
		Path:   absolute,
		Parent: parent,
		IsRepo: isJJRepo(absolute),
		Dirs:   dirs,
	})
}

func isJJRepo(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, ".jj"))
	return err == nil && info.IsDir()
}

func expandHome(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			return filepath.Join(home, strings.TrimPrefix(path, "~"))
		}
	}
	return path
}
