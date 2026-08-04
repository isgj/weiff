package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDefaultDirectory(t *testing.T) {
	configHome := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", configHome)

	directory, err := DefaultDirectory()
	if err != nil {
		t.Fatalf("DefaultDirectory() error = %v", err)
	}
	want := filepath.Join(configHome, "weiff")
	if directory != want {
		t.Fatalf("DefaultDirectory() = %q, want %q", directory, want)
	}
}

func TestStoreLoadMissingReturnsEmptyConfig(t *testing.T) {
	store := newTestStore(t)

	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got.CurrentRepository != "" || len(got.Repositories) != 0 {
		t.Fatalf("Load() = %#v, want empty config", got)
	}
}

func TestStoreSaveAndLoadNormalizesRepositories(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "weiff")
	path := filepath.Join(directory, "config.json")
	store, err := NewStore(directory)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}

	written, err := store.Save(Config{
		CurrentRepository: "  /tmp/current  ",
		Repositories: []Repository{
			{Path: "/tmp/other", Name: " Other repo "},
			{Path: "/tmp/current", Name: "Current repo"},
			{Path: "/tmp/other"},
			{Path: "  "},
		},
		LogRevset: "  description(feat)  ",
	})
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	if written.CurrentRepository != "/tmp/current" {
		t.Fatalf("current repository = %q, want %q", written.CurrentRepository, "/tmp/current")
	}
	if written.LogRevset != "description(feat)" {
		t.Fatalf("log revset = %q, want %q", written.LogRevset, "description(feat)")
	}
	wantRepositories := []Repository{
		{Path: "/tmp/current", Name: "Current repo"},
		{Path: "/tmp/other", Name: "Other repo"},
	}
	if len(written.Repositories) != len(wantRepositories) {
		t.Fatalf("repositories = %#v, want %#v", written.Repositories, wantRepositories)
	}
	for i := range wantRepositories {
		if written.Repositories[i] != wantRepositories[i] {
			t.Fatalf("repositories[%d] = %#v, want %#v", i, written.Repositories[i], wantRepositories[i])
		}
	}

	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if loaded.CurrentRepository != written.CurrentRepository || loaded.LogRevset != written.LogRevset {
		t.Fatalf("Load() = %#v, want %#v", loaded, written)
	}
	if len(loaded.Repositories) != len(written.Repositories) {
		t.Fatalf("loaded repositories = %#v, want %#v", loaded.Repositories, written.Repositories)
	}
	currentRepository, err := store.CurrentRepository()
	if err != nil {
		t.Fatalf("CurrentRepository() error = %v", err)
	}
	if currentRepository != written.CurrentRepository {
		t.Fatalf("CurrentRepository() = %q, want %q", currentRepository, written.CurrentRepository)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if !strings.HasSuffix(string(data), "\n") {
		t.Fatal("config file does not end with a newline")
	}
	if runtime.GOOS != "windows" {
		assertMode(t, filepath.Dir(path), 0o700)
		assertMode(t, path, 0o600)
	}
}

func TestStoreLoadRejectsUnknownFields(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "weiff")
	path := filepath.Join(directory, "config.json")
	store, err := NewStore(directory)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	if err := os.WriteFile(path, []byte(`{"repositories":[],"unknown":true}`), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if _, err := store.Load(); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("Load() error = %v, want unknown field error", err)
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "weiff"))
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	return store
}

func assertMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat(%q) error = %v", path, err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Fatalf("mode for %q = %o, want %o", path, got, want)
	}
}
