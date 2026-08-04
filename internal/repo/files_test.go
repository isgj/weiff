package repo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCleanRepositoryFilePath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		path    string
		want    string
		wantErr bool
	}{
		{name: "root", path: "", want: ""},
		{name: "file", path: "web/src/app.ts", want: "web/src/app.ts"},
		{name: "spaces", path: "docs/a file.md", want: "docs/a file.md"},
		{name: "absolute", path: "/etc/passwd", wantErr: true},
		{name: "parent", path: "../outside", wantErr: true},
		{name: "nested parent", path: "web/../../outside", wantErr: true},
		{name: "dot segment", path: "web/./src", wantErr: true},
		{name: "duplicate separator", path: "web//src", wantErr: true},
		{name: "trailing separator", path: "web/src/", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			got, err := cleanRepositoryFilePath(test.path)
			if test.wantErr {
				if !errors.Is(err, ErrInvalidRepositoryFilePath) {
					t.Fatalf("cleanRepositoryFilePath(%q) error = %v, want invalid path", test.path, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("cleanRepositoryFilePath(%q) error = %v", test.path, err)
			}
			if got != test.want {
				t.Fatalf("cleanRepositoryFilePath(%q) = %q, want %q", test.path, got, test.want)
			}
		})
	}
}

func TestDecodeRepositoryTreeReturnsImmediateChildren(t *testing.T) {
	t.Parallel()

	tree := `Tree {
    entries: [
        (
            "API",
            Tree(
            ),
        ),
        (
            "api",
            Tree(
            ),
        ),
        (
            "alpha.go",
            File {
                executable: true,
            },
        ),
        (
            "broken",
            Conflict(
            ),
        ),
        (
            "link",
            Symlink(
            ),
        ),
        (
            "module",
            GitSubmodule(
            ),
        ),
        (
            "zeta.go",
            File {
                executable: false,
            },
        ),
    ],
}`

	got, err := decodeRepositoryTree([]byte(tree), "src")
	if err != nil {
		t.Fatalf("decodeRepositoryTree() error = %v", err)
	}
	if len(got) != 7 {
		t.Fatalf("entries = %#v, want 7 children", got)
	}
	wantNames := []string{"API", "api", "alpha.go", "broken", "link", "module", "zeta.go"}
	for index, want := range wantNames {
		if got[index].Name != want {
			t.Fatalf("entry %d name = %q, want %q", index, got[index].Name, want)
		}
	}
	if got[0].Kind != RepositoryFileKindDirectory || got[1].Kind != RepositoryFileKindDirectory {
		t.Fatalf("directory entries = %#v, want directories first", got[:2])
	}
	if !got[2].Executable {
		t.Fatal("alpha.go executable = false, want true")
	}
	if got[3].Kind != RepositoryFileKindConflict || !got[3].Conflict {
		t.Fatalf("broken entry = %#v, want conflict", got[3])
	}
	if got[4].Kind != RepositoryFileKindSymlink {
		t.Fatalf("link kind = %q, want symlink", got[4].Kind)
	}
	if got[5].Kind != RepositoryFileKindGitSubmodule {
		t.Fatalf("module kind = %q, want git-submodule", got[5].Kind)
	}
}

func TestRepositoryFilesListsDirectoryAtPinnedRevision(t *testing.T) {
	tree := `Tree {
    entries: [
        (
            "api",
            Tree(
            ),
        ),
        (
            "main.go",
            File {
                executable: true,
            },
        ),
    ],
}`
	client, argsPath := newRepositoryFilesTestClient(t, tree, "", "")

	result, err := client.RepositoryFiles(context.Background(), RequestOptions{}, "feature-change", "src")
	if err != nil {
		t.Fatalf("RepositoryFiles() error = %v", err)
	}
	if result.Kind != RepositoryFileKindDirectory || result.Path != "src" {
		t.Fatalf("result = %#v, want src directory", result)
	}
	if result.Rev != "resolvedcommit" {
		t.Fatalf("rev = %q, want resolvedcommit", result.Rev)
	}
	if len(result.Entries) != 2 || result.Entries[0].Name != "api" || result.Entries[1].Name != "main.go" {
		t.Fatalf("entries = %#v, want api then main.go", result.Entries)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if !strings.Contains(string(args), "debug\nobject\ntree\n--no-pager\n--color=never\n-r\nresolvedcommit\n--\nsrc\n") {
		t.Fatalf("args = %q, want tree lookup pinned to resolvedcommit", string(args))
	}
	if !strings.Contains(string(args), "--revision\nfeature-change\n") {
		t.Fatalf("args = %q, want requested revision resolved before listing", string(args))
	}
	if !strings.Contains(string(args), "--\n"+`file:"src"`+"\n") {
		t.Fatalf("args = %q, want exact file lookup before directory listing", string(args))
	}
}

func TestRepositoryFilesListsOnlyRootTree(t *testing.T) {
	tree := `Tree {
    entries: [
        (
            "cmd",
            Tree(
            ),
        ),
        (
            "README.md",
            File {
                executable: false,
            },
        ),
    ],
}`
	client, argsPath := newRepositoryFilesTestClient(
		t,
		tree,
		"recursive output must not be used",
		"",
	)

	result, err := client.RepositoryFiles(context.Background(), RequestOptions{}, "@", "")
	if err != nil {
		t.Fatalf("RepositoryFiles() error = %v", err)
	}
	if len(result.Entries) != 2 || result.Entries[0].Name != "cmd" || result.Entries[1].Name != "README.md" {
		t.Fatalf("entries = %#v, want cmd then README.md", result.Entries)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if strings.Contains(string(args), "file\nlist\n") {
		t.Fatalf("args = %q, root listing must not run recursive file list", string(args))
	}
}

func TestRepositoryFilesReadsTextFile(t *testing.T) {
	list := `{"path":"docs/-odd name.md","kind":"file","conflict":false,"executable":false}` + "\n"
	client, argsPath := newRepositoryFilesTestClient(t, "", list, "# Heading\n")

	result, err := client.RepositoryFiles(context.Background(), RequestOptions{}, "", "docs/-odd name.md")
	if err != nil {
		t.Fatalf("RepositoryFiles() error = %v", err)
	}
	if result.Kind != RepositoryFileKindFile || result.Content != "# Heading\n" {
		t.Fatalf("result = %#v, want Markdown file content", result)
	}
	if result.Binary || result.Truncated || result.MaxBytes != maxRepositoryFileBytes {
		t.Fatalf("preview state = binary %v, truncated %v, max %d", result.Binary, result.Truncated, result.MaxBytes)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if !strings.Contains(string(args), `file:"docs/-odd name.md"`+"\n") {
		t.Fatalf("args = %q, want exact file fileset", string(args))
	}
}

func TestRepositoryFilesMarksBinaryContent(t *testing.T) {
	list := `{"path":"image.bin","kind":"file","conflict":false,"executable":false}` + "\n"
	client, _ := newRepositoryFilesTestClient(t, "", list, "before\\000after")

	result, err := client.RepositoryFiles(context.Background(), RequestOptions{}, "", "image.bin")
	if err != nil {
		t.Fatalf("RepositoryFiles() error = %v", err)
	}
	if !result.Binary || result.Content != "" {
		t.Fatalf("result = %#v, want binary file without text content", result)
	}
}

func TestRepositoryFilesReturnsNotFound(t *testing.T) {
	client, _ := newRepositoryFilesTestClient(t, "", "", "")

	_, err := client.RepositoryFiles(context.Background(), RequestOptions{}, "", "missing")
	if !errors.Is(err, ErrRepositoryFileNotFound) {
		t.Fatalf("RepositoryFiles() error = %v, want path not found", err)
	}
}

func newRepositoryFilesTestClient(t *testing.T, treeOutput string, listOutput string, fileOutput string) (*JJClient, string) {
	t.Helper()

	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	commit := `{"commitId":"resolvedcommit","changeId":"workingchange","description":"","authorName":"","authorEmail":"","authorTimestamp":"","current":true,"empty":false,"bookmarks":[]}`
	script := "#!/bin/sh\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n" +
		"case \"$1:$2\" in\n" +
		"  log:--no-pager) printf '%s\\n' " + shellQuote(commit) + " ;;\n" +
		"  debug:object) " + repositoryTreeTestCommand(treeOutput) + " ;;\n" +
		"  file:list) printf '%s' " + shellQuote(listOutput) + " ;;\n" +
		"  file:show) printf '%b' " + shellQuote(fileOutput) + " ;;\n" +
		"esac\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	return &JJClient{repoPath: dir, executable: executable}, argsPath
}

func repositoryTreeTestCommand(output string) string {
	if output == "" {
		return "printf '%s\\n' 'Error: The path is not a single tree in the commit' >&2; exit 1"
	}
	return "printf '%s' " + shellQuote(output)
}
