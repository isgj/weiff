package repo

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestDecodeJSONLinesEmptyReturnsJSONArray(t *testing.T) {
	values, err := decodeJSONLines[Bookmark](nil)
	if err != nil {
		t.Fatalf("decode JSON lines: %v", err)
	}

	encoded, err := json.Marshal(values)
	if err != nil {
		t.Fatalf("marshal values: %v", err)
	}
	if string(encoded) != "[]" {
		t.Fatalf("encoded = %s, want []", encoded)
	}
}

func TestRepoPathForReadsConfiguredRepository(t *testing.T) {
	first := t.TempDir()
	second := t.TempDir()
	configured := first
	client := NewJJClientWithRepoPathResolver(func() (string, error) {
		return configured, nil
	})

	got, err := client.repoPathFor(RequestOptions{})
	if err != nil {
		t.Fatalf("repoPathFor() error = %v", err)
	}
	if got != first {
		t.Fatalf("repoPathFor() = %q, want %q", got, first)
	}

	configured = second
	got, err = client.repoPathFor(RequestOptions{})
	if err != nil {
		t.Fatalf("repoPathFor() after config change error = %v", err)
	}
	if got != second {
		t.Fatalf("repoPathFor() after config change = %q, want %q", got, second)
	}
}

func TestRepoPathForRequiresConfiguredRepository(t *testing.T) {
	client := NewJJClientWithRepoPathResolver(func() (string, error) {
		return "", nil
	})

	_, err := client.repoPathFor(RequestOptions{})
	if err == nil || err.Error() != "repository path is required" {
		t.Fatalf("repoPathFor() error = %v, want repository path is required", err)
	}
}

func TestRepoPathForUsesExplicitRequestWithoutReadingConfig(t *testing.T) {
	want := t.TempDir()
	client := NewJJClientWithRepoPathResolver(func() (string, error) {
		t.Fatal("configured repository resolver should not be called")
		return "", nil
	})

	got, err := client.repoPathFor(RequestOptions{RepoPath: want})
	if err != nil {
		t.Fatalf("repoPathFor() error = %v", err)
	}
	if got != want {
		t.Fatalf("repoPathFor() = %q, want %q", got, want)
	}
}

func TestRunPreservesContextError(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "jj")
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nexec sleep 10\n"), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}
	client := &JJClient{repoPath: dir, executable: executable}

	tests := []struct {
		name       string
		newContext func() (context.Context, context.CancelFunc)
		want       error
	}{
		{
			name: "deadline exceeded",
			newContext: func() (context.Context, context.CancelFunc) {
				return context.WithTimeout(context.Background(), 20*time.Millisecond)
			},
			want: context.DeadlineExceeded,
		},
		{
			name: "canceled",
			newContext: func() (context.Context, context.CancelFunc) {
				ctx, cancel := context.WithCancel(context.Background())
				timer := time.AfterFunc(20*time.Millisecond, cancel)
				return ctx, func() {
					timer.Stop()
					cancel()
				}
			},
			want: context.Canceled,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := test.newContext()
			defer cancel()

			_, err := client.run(ctx, dir)
			if !errors.Is(err, test.want) {
				t.Fatalf("run() error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestDecodeGraphLogPreservesGraphRows(t *testing.T) {
	data := []byte(`@  {"commitId":"merge","changeId":"m","description":"merge","authorName":"Ada","authorEmail":"ada@example.com","authorTimestamp":"2026-06-18T12:00:00Z","current":true,"empty":false,"bookmarks":[]}
├─╮
│ ○  {"commitId":"left","changeId":"l","description":"left","authorName":"Ada","authorEmail":"ada@example.com","authorTimestamp":"2026-06-18T12:00:00Z","current":false,"empty":false,"bookmarks":[]}
`)

	commits, graphRows, err := decodeGraphLog(data)
	if err != nil {
		t.Fatalf("decode graph log: %v", err)
	}
	if len(commits) != 2 {
		t.Fatalf("commits len = %d, want 2", len(commits))
	}
	if len(graphRows) != 3 {
		t.Fatalf("graph rows len = %d, want 3", len(graphRows))
	}
	if graphRows[0].CommitID != "merge" || graphRows[0].Graph != "@" {
		t.Fatalf("first graph row = %+v, want commit merge graph @", graphRows[0])
	}
	if graphRows[1].CommitID != "" || graphRows[1].Graph != "├─╮" {
		t.Fatalf("connector graph row = %+v, want graph-only connector", graphRows[1])
	}
	if graphRows[2].CommitID != "left" || graphRows[2].Graph != "│ ○" {
		t.Fatalf("third graph row = %+v, want commit left graph │ ○", graphRows[2])
	}
}

func TestDecodePrefixedJSONLinesSkipsGraphRows(t *testing.T) {
	data := []byte(`<  
○  {"commitId":"abc","changeId":"change","description":"work"}
│
◆  {"commitId":"def","changeId":"next","description":"next work"}
`)

	values, err := decodePrefixedJSONLines[EvolutionEntry](data)
	if err != nil {
		t.Fatalf("decode prefixed JSON lines: %v", err)
	}
	if len(values) != 2 {
		t.Fatalf("values len = %d, want 2", len(values))
	}
	if values[0].CommitID != "abc" || values[1].CommitID != "def" {
		t.Fatalf("commit ids = %+v, want abc and def", values)
	}
}

func TestCommitRunsJjLogForOneRevision(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	commitLine := `○  {"commitId":"1234567890abcdef","changeId":"abcdefghijklmnop","description":"remote work\n\nbody","authorName":"Ada","authorEmail":"ada@example.com","authorTimestamp":"2026-06-29T12:00:00Z","current":false,"empty":false,"bookmarks":[],"tags":["v1.0.0","release"]}`
	script := "#!/bin/sh\n" +
		": > " + shellQuote(argsPath) + "\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n" +
		"case \"$1\" in\n" +
		"  log)\n" +
		"    printf '%s\\n' " + shellQuote(commitLine) + "\n" +
		"    ;;\n" +
		"esac\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.Commit(context.Background(), RequestOptions{}, "remotebookmark")
	if err != nil {
		t.Fatalf("commit: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if !strings.Contains(string(args), "log\n--no-pager\n--color=never\n--limit\n1\n--revision\nremotebookmark\n") {
		t.Fatalf("args = %q, want jj log for one requested revision", string(args))
	}
	if strings.Contains(string(args), `"parents"`) || strings.Contains(string(args), `"parentChangeIds"`) {
		t.Fatalf("args = %q, should not request parent ids", string(args))
	}
	if !strings.Contains(string(args), "local_tags.map(|t| t.name())") {
		t.Fatalf("args = %q, should request local tags", string(args))
	}
	if result.Rev != "1234567890abcdef" {
		t.Fatalf("rev = %q, want resolved commit id", result.Rev)
	}
	if result.Commit.ShortCommitID != "1234567890ab" {
		t.Fatalf("short commit = %q, want 1234567890ab", result.Commit.ShortCommitID)
	}
	if result.Commit.ShortChangeID != "abcdefghijkl" {
		t.Fatalf("short change = %q, want abcdefghijkl", result.Commit.ShortChangeID)
	}
	if result.Commit.Summary != "remote work" {
		t.Fatalf("summary = %q, want remote work", result.Commit.Summary)
	}
	if len(result.Commit.Tags) != 2 || result.Commit.Tags[0] != "v1.0.0" || result.Commit.Tags[1] != "release" {
		t.Fatalf("tags = %v, want [v1.0.0 release]", result.Commit.Tags)
	}
}

func TestCommitFallsBackToCommitIDWhenChangeIDIsAmbiguous(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "jj")
	script := fakeRevisionScript(map[string]fakeRevision{
		"changedivergent": {err: "ambiguous change id"},
		"commitright": {
			commitID:     "commitright",
			changeID:     "changedivergent",
			changeOffset: 1,
			description:  "right side",
			divergent:    true,
		},
	})
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.Commit(context.Background(), RequestOptions{CommitID: "commitright"}, "changedivergent")
	if err != nil {
		t.Fatalf("commit: %v", err)
	}

	if result.Rev != "commitright" {
		t.Fatalf("rev = %q, want commitright fallback", result.Rev)
	}
	if result.Commit.CommitID != "commitright" || result.Commit.ChangeID != "changedivergent" {
		t.Fatalf("commit = %+v, want commitright on changedivergent", result.Commit)
	}
	if result.Commit.ChangeOffset == nil || *result.Commit.ChangeOffset != 1 {
		t.Fatalf("change offset = %v, want 1", result.Commit.ChangeOffset)
	}
	if !result.Commit.Divergent {
		t.Fatal("commit divergent = false, want true")
	}
}

func TestCommitRejectsUnrelatedCommitIDFallback(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "jj")
	script := fakeRevisionScript(map[string]fakeRevision{
		"changedivergent": {err: "ambiguous change id"},
		"unrelated": {
			commitID:    "unrelated",
			changeID:    "otherchange",
			description: "wrong change",
		},
	})
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	_, err := client.Commit(context.Background(), RequestOptions{CommitID: "unrelated"}, "changedivergent")
	if err == nil || !strings.Contains(err.Error(), "belongs to change") {
		t.Fatalf("commit error = %v, want unrelated fallback error", err)
	}
}

func TestReadEndpointsPinResolvedCommitID(t *testing.T) {
	endpoints := []struct {
		name string
		run  func(*JJClient, RequestOptions, string) (string, error)
	}{
		{
			name: "diff",
			run: func(client *JJClient, opts RequestOptions, rev string) (string, error) {
				result, err := client.Diff(context.Background(), opts, rev, false)
				return result.Rev, err
			},
		},
		{
			name: "file content",
			run: func(client *JJClient, opts RequestOptions, rev string) (string, error) {
				result, err := client.FileContent(context.Background(), opts, rev, "file.txt")
				return result.Rev, err
			},
		},
		{
			name: "evolution log",
			run: func(client *JJClient, opts RequestOptions, rev string) (string, error) {
				result, err := client.EvolutionLog(context.Background(), opts, rev, 10)
				return result.Rev, err
			},
		},
	}
	scenarios := []struct {
		name       string
		rev        string
		opts       RequestOptions
		resolvedID string
		revisions  map[string]fakeRevision
	}{
		{
			name:       "stable change",
			rev:        "stablechange",
			resolvedID: "stablecommit",
			revisions: map[string]fakeRevision{
				"stablechange": {commitID: "stablecommit", changeID: "stablechange"},
			},
		},
		{
			name:       "commit id fallback",
			rev:        "sharedchange",
			opts:       RequestOptions{CommitID: "rightcommit"},
			resolvedID: "rightcommit",
			revisions: map[string]fakeRevision{
				"sharedchange": {err: "ambiguous change id"},
				"rightcommit":  {commitID: "rightcommit", changeID: "sharedchange", divergent: true},
			},
		},
	}

	for _, scenario := range scenarios {
		for _, endpoint := range endpoints {
			t.Run(scenario.name+"/"+endpoint.name, func(t *testing.T) {
				dir := t.TempDir()
				argsPath := filepath.Join(dir, "args")
				executable := filepath.Join(dir, "jj")
				script := fakePinnedReadScript(argsPath, scenario.resolvedID, scenario.revisions)
				if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
					t.Fatalf("write fake jj: %v", err)
				}

				client := &JJClient{repoPath: dir, executable: executable}
				gotRev, err := endpoint.run(client, scenario.opts, scenario.rev)
				if err != nil {
					t.Fatalf("%s: %v", endpoint.name, err)
				}
				if gotRev != scenario.resolvedID {
					t.Fatalf("resolved rev = %q, want %q", gotRev, scenario.resolvedID)
				}

				args, err := os.ReadFile(argsPath)
				if err != nil {
					t.Fatalf("read args: %v", err)
				}
				if !strings.Contains(string(args), "\t-r\t"+scenario.resolvedID+"\t") {
					t.Fatalf("args = %q, want read pinned to %q", string(args), scenario.resolvedID)
				}
			})
		}
	}
}

func TestEnrichCommitsMarksDivergentChanges(t *testing.T) {
	firstOffset := 0
	secondOffset := 1
	commits := []Commit{
		{CommitID: "firstcommit", ChangeID: "sharedchange", ChangeOffset: &firstOffset},
		{CommitID: "secondcommit", ChangeID: "sharedchange", ChangeOffset: &secondOffset},
		{CommitID: "thirdcommit", ChangeID: "solochange", Divergent: true},
	}

	enrichCommits(commits)

	if !commits[0].Divergent || !commits[1].Divergent {
		t.Fatalf("shared change commits should be marked divergent: %+v", commits)
	}
	if !commits[2].Divergent {
		t.Fatalf("jj divergent flag should be preserved without visible duplicate count: %+v", commits[2])
	}
	if commits[0].Tags == nil {
		t.Fatal("tags should be normalized to an empty slice")
	}
}

func TestParseGitDiffEmptyReturnsJSONArray(t *testing.T) {
	files := ParseGitDiff("", nil)

	encoded, err := json.Marshal(files)
	if err != nil {
		t.Fatalf("marshal files: %v", err)
	}
	if string(encoded) != "[]" {
		t.Fatalf("encoded = %s, want []", encoded)
	}
}

func TestParseGitDiffPreservesConflictMetadata(t *testing.T) {
	files := ParseGitDiff(
		"diff --git a/conflicted.go b/conflicted.go\n+new\n",
		[]DiffFile{{Path: "conflicted.go", Status: "modified", StatusChar: "M", Conflict: true}},
	)

	if len(files) != 1 {
		t.Fatalf("files len = %d, want 1", len(files))
	}
	if !files[0].Conflict {
		t.Fatalf("conflict = false, want true")
	}
}

func TestPathFromDiffHeaderHandlesSpacesAndQuotes(t *testing.T) {
	cases := []struct {
		line string
		want string
	}{
		{"diff --git a/simple.go b/simple.go", "simple.go"},
		{"diff --git a/dir/my file.txt b/dir/my file.txt", "dir/my file.txt"},
		{`diff --git "a/dir/spaced name.txt" "b/dir/spaced name.txt"`, "dir/spaced name.txt"},
		{"not a diff header", ""},
	}
	for _, tc := range cases {
		if got := pathFromDiffHeader(tc.line); got != tc.want {
			t.Errorf("pathFromDiffHeader(%q) = %q, want %q", tc.line, got, tc.want)
		}
	}
}

func TestParseDiffTypesMarksConflictedFiles(t *testing.T) {
	conflicts := parseDiffTypes([]byte(`FF clean.go
FC current-conflict.go
CF parent-conflict.go
F- removed.go
`))

	if conflicts["clean.go"] {
		t.Fatalf("clean.go marked conflicted")
	}
	for _, path := range []string{"current-conflict.go", "parent-conflict.go"} {
		if !conflicts[path] {
			t.Fatalf("%s not marked conflicted", path)
		}
	}
}

func TestPushBookmarkRunsJjGitPushBookmark(t *testing.T) {
	cases := []struct {
		name     string
		req      PushBookmarkRequest
		wantArgs string
	}{
		{
			name:     "default remote",
			req:      PushBookmarkRequest{Name: "feature/ui"},
			wantArgs: "git\npush\n-b\nfeature/ui\n",
		},
		{
			name:     "explicit remote",
			req:      PushBookmarkRequest{Name: "feature/ui", Remote: "upstream"},
			wantArgs: "git\npush\n-b\nfeature/ui\n--remote\nupstream\n",
		},
		{
			name:     "new bookmark on remote",
			req:      PushBookmarkRequest{Name: "feature/ui", Remote: "origin", AllowNew: true},
			wantArgs: "git\npush\n-b\nfeature/ui\n--remote\norigin\n--allow-new\n",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			argsPath := filepath.Join(dir, "args")
			executable := filepath.Join(dir, "jj")
			script := "#!/bin/sh\n" +
				": > " + shellQuote(argsPath) + "\n" +
				"for arg in \"$@\"; do\n" +
				"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
				"done\n"
			if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
				t.Fatalf("write fake jj: %v", err)
			}

			client := &JJClient{repoPath: dir, executable: executable}
			result, err := client.PushBookmark(context.Background(), RequestOptions{}, tc.req)
			if err != nil {
				t.Fatalf("push bookmark: %v", err)
			}

			args, err := os.ReadFile(argsPath)
			if err != nil {
				t.Fatalf("read args: %v", err)
			}
			if string(args) != tc.wantArgs {
				t.Fatalf("args = %q, want %q", string(args), tc.wantArgs)
			}
			if got, want := strings.Join(result.Command[1:], " "), strings.ReplaceAll(strings.TrimSuffix(tc.wantArgs, "\n"), "\n", " "); got != want {
				t.Fatalf("command = %q, want %q", got, want)
			}
		})
	}
}

func TestRemotesListsGitRemotes(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n" +
		"printf '%s\\n' 'origin git@github.com:me/repo.git'\n" +
		"printf '%s\\n' 'upstream https://github.com/them/repo.git'\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.Remotes(context.Background(), RequestOptions{})
	if err != nil {
		t.Fatalf("remotes: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if !strings.Contains(string(args), "git\nremote\nlist\n") {
		t.Fatalf("args = %q, want git remote list", string(args))
	}
	want := []Remote{
		{Name: "origin", URL: "git@github.com:me/repo.git"},
		{Name: "upstream", URL: "https://github.com/them/repo.git"},
	}
	if len(result.Remotes) != len(want) {
		t.Fatalf("remotes = %+v, want %+v", result.Remotes, want)
	}
	for i, remote := range want {
		if result.Remotes[i] != remote {
			t.Fatalf("remotes[%d] = %+v, want %+v", i, result.Remotes[i], remote)
		}
	}
}

func TestBookmarksListsAllRemoteBookmarks(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n" +
		"printf '%s\\n' '---' >> " + shellQuote(argsPath) + "\n" +
		"case \"$1\" in\n" +
		"  bookmark)\n" +
		"    printf '%s\\n' '{\"name\":\"teammate\",\"remote\":\"origin\",\"present\":true,\"conflict\":false,\"tracked\":false,\"synced\":false,\"target\":\"abc\"}'\n" +
		"    ;;\n" +
		"esac\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.Bookmarks(context.Background(), RequestOptions{})
	if err != nil {
		t.Fatalf("bookmarks: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if !strings.Contains(string(args), "bookmark\nlist\n--all-remotes\n--no-pager\n") {
		t.Fatalf("args = %q, want bookmark list --all-remotes", string(args))
	}
	if len(result.Bookmarks) != 1 || result.Bookmarks[0].Name != "teammate" {
		t.Fatalf("bookmarks = %+v, want teammate remote bookmark", result.Bookmarks)
	}
}

func TestWorkspacesListsWorkspaceState(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n" +
		"printf '%s\\n' '---' >> " + shellQuote(argsPath) + "\n" +
		"case \"$1\" in\n" +
		"  workspace)\n" +
		"    printf '%s\\n' '{\"name\":\"default\",\"root\":" + strconv.Quote(dir) + ",\"target\":\"abc\",\"changeId\":\"change\",\"description\":\"work\"}'\n" +
		"    ;;\n" +
		"esac\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.Workspaces(context.Background(), RequestOptions{})
	if err != nil {
		t.Fatalf("workspaces: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if !strings.Contains(string(args), "workspace\nlist\n--no-pager\n") {
		t.Fatalf("args = %q, want workspace list", string(args))
	}
	if len(result.Workspaces) != 1 {
		t.Fatalf("workspaces len = %d, want 1", len(result.Workspaces))
	}
	if result.Workspaces[0].Name != "default" || result.Workspaces[0].Root != dir || !result.Workspaces[0].Current {
		t.Fatalf("workspace = %+v, want current default workspace rooted at temp dir", result.Workspaces[0])
	}
	if result.Workspaces[0].ShortTarget != "abc" || result.Workspaces[0].ShortChangeID != "change" {
		t.Fatalf("workspace short ids = %+v, want abc/change", result.Workspaces[0])
	}
}

func TestOperationLogListsOperations(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n" +
		"printf '%s\\n' '---' >> " + shellQuote(argsPath) + "\n" +
		"case \"$1\" in\n" +
		"  op)\n" +
		"    printf '%s\\n' '{\"id\":\"1234567890abcdef\",\"parents\":[\"abcdef1234567890\"],\"description\":\"snapshot working copy\",\"user\":\"ada@example.com\",\"timestamp\":\"2026-06-29T12:00:00Z\",\"current\":true,\"snapshot\":true,\"workspaceName\":\"default@\",\"root\":false,\"attributes\":\"args: jj status\"}'\n" +
		"    ;;\n" +
		"esac\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.OperationLog(context.Background(), RequestOptions{}, 12)
	if err != nil {
		t.Fatalf("operation log: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if !strings.Contains(string(args), "op\nlog\n--no-pager\n--color=never\n-G\n--limit\n13\n") {
		t.Fatalf("args = %q, want op log with look-ahead limit 13 and no graph", string(args))
	}
	if len(result.Operations) != 1 {
		t.Fatalf("operations len = %d, want 1", len(result.Operations))
	}
	got := result.Operations[0]
	if got.ShortID != "1234567890ab" || len(got.ShortParents) != 1 || got.ShortParents[0] != "abcdef123456" {
		t.Fatalf("operation short ids = %+v, want shortened operation and parent ids", got)
	}
	if !got.Current || !got.Snapshot || got.Description != "snapshot working copy" {
		t.Fatalf("operation = %+v, want current snapshot operation", got)
	}
	if result.Limit != 12 || result.HasMore {
		t.Fatalf("pagination = limit %d, hasMore %t; want 12, false", result.Limit, result.HasMore)
	}
}

func TestOperationLogUsesLookAheadToReportMoreOperations(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "jj")
	var output strings.Builder
	for i := range 3 {
		output.WriteString(`{"id":"1234567890abcde` + strconv.Itoa(i) + `","parents":[],"description":"operation","user":"ada@example.com","timestamp":"2026-06-29T12:00:00Z"}`)
		output.WriteByte('\n')
	}
	script := "#!/bin/sh\nprintf '%s' " + shellQuote(output.String()) + "\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.OperationLog(context.Background(), RequestOptions{}, 2)
	if err != nil {
		t.Fatalf("operation log: %v", err)
	}

	if len(result.Operations) != 2 {
		t.Fatalf("operations len = %d, want 2", len(result.Operations))
	}
	if result.Limit != 2 || !result.HasMore {
		t.Fatalf("pagination = limit %d, hasMore %t; want 2, true", result.Limit, result.HasMore)
	}
}

func TestOperationLogWithoutLimitOmitsLimitFlag(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		": > " + shellQuote(argsPath) + "\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	if _, err := client.OperationLog(context.Background(), RequestOptions{}, 0); err != nil {
		t.Fatalf("operation log: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if strings.Contains(string(args), "\n--limit\n") {
		t.Fatalf("args = %q, want op log without --limit", string(args))
	}
	if !strings.Contains(string(args), "op\nlog\n--no-pager\n--color=never\n-G\n") {
		t.Fatalf("args = %q, want op log arguments", string(args))
	}
}

func TestRestoreOperationRunsJjOpRestore(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		": > " + shellQuote(argsPath) + "\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.RestoreOperation(context.Background(), RequestOptions{}, "abc123")
	if err != nil {
		t.Fatalf("restore operation: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if string(args) != "op\nrestore\nabc123\n" {
		t.Fatalf("args = %q, want op restore abc123", string(args))
	}
	if got, want := strings.Join(result.Command[1:], " "), "op restore abc123"; got != want {
		t.Fatalf("command = %q, want %q", got, want)
	}
}

func TestUndoLastOperationRunsJjUndo(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		": > " + shellQuote(argsPath) + "\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.UndoLastOperation(context.Background(), RequestOptions{})
	if err != nil {
		t.Fatalf("undo last operation: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if string(args) != "undo\n" {
		t.Fatalf("args = %q, want undo", string(args))
	}
	if got, want := strings.Join(result.Command[1:], " "), "undo"; got != want {
		t.Fatalf("command = %q, want %q", got, want)
	}
}

func TestAddWorkspaceRunsJjWorkspaceAdd(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		": > " + shellQuote(argsPath) + "\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.AddWorkspace(context.Background(), RequestOptions{}, WorkspaceRequest{
		Destination:    "/tmp/weiff-work",
		Name:           "weiff-work",
		Rev:            "change",
		Message:        "new work",
		SparsePatterns: "full",
	})
	if err != nil {
		t.Fatalf("add workspace: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	want := "workspace\nadd\n--name\nweiff-work\n--revision\nchange\n--message\nnew work\n--sparse-patterns\nfull\n/tmp/weiff-work\n"
	if string(args) != want {
		t.Fatalf("args = %q, want %q", string(args), want)
	}
	if got, want := strings.Join(result.Command[1:], " "), "workspace add --name weiff-work --revision change --message new work --sparse-patterns full /tmp/weiff-work"; got != want {
		t.Fatalf("command = %q, want %q", got, want)
	}
}

func TestAddWorkspaceExpandsHomeDestination(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		": > " + shellQuote(argsPath) + "\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.AddWorkspace(context.Background(), RequestOptions{}, WorkspaceRequest{
		Destination: "~/weiff-work",
		Rev:         "@",
	})
	if err != nil {
		t.Fatalf("add workspace: %v", err)
	}

	destination := filepath.Join(home, "weiff-work")
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	want := "workspace\nadd\n--revision\n@\n" + destination + "\n"
	if string(args) != want {
		t.Fatalf("args = %q, want %q", string(args), want)
	}
	if got, want := strings.Join(result.Command[1:], " "), "workspace add --revision @ "+destination; got != want {
		t.Fatalf("command = %q, want %q", got, want)
	}
}

func TestForgetWorkspaceRunsJjWorkspaceForget(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		": > " + shellQuote(argsPath) + "\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.ForgetWorkspace(context.Background(), RequestOptions{}, "weiff-work")
	if err != nil {
		t.Fatalf("forget workspace: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if string(args) != "workspace\nforget\nweiff-work\n" {
		t.Fatalf("args = %q, want workspace forget weiff-work", string(args))
	}
	if got, want := strings.Join(result.Command[1:], " "), "workspace forget weiff-work"; got != want {
		t.Fatalf("command = %q, want %q", got, want)
	}
}

func TestRestorePathsRunsJjRestoreChangesIn(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		": > " + shellQuote(argsPath) + "\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.RestorePaths(context.Background(), RequestOptions{}, "abc", []string{"src/main.go", " ", "docs/readme.md"})
	if err != nil {
		t.Fatalf("restore paths: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	want := "restore\n--changes-in\nabc\nfile:\"src/main.go\"\nfile:\"docs/readme.md\"\n"
	if string(args) != want {
		t.Fatalf("args = %q, want %q", string(args), want)
	}
	if got, want := strings.Join(result.Command[1:], " "), `restore --changes-in abc file:"src/main.go" file:"docs/readme.md"`; got != want {
		t.Fatalf("command = %q, want %q", got, want)
	}
}

func TestDescribeRunsJjDescribe(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		": > " + shellQuote(argsPath) + "\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	result, err := client.Describe(context.Background(), RequestOptions{}, "abc", DescribeRequest{Title: "feat: new thing", Body: "longer explanation\n"})
	if err != nil {
		t.Fatalf("describe: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	want := "describe\n-r\nabc\n-m\nfeat: new thing\n\nlonger explanation\n"
	if string(args) != want {
		t.Fatalf("args = %q, want %q", string(args), want)
	}
	if got, want := strings.Join(result.Command[1:], " "), "describe -r abc -m feat: new thing\n\nlonger explanation"; got != want {
		t.Fatalf("command = %q, want %q", got, want)
	}
}

func TestDescribeTitleOnlyOmitsBody(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	script := "#!/bin/sh\n" +
		": > " + shellQuote(argsPath) + "\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable}
	if _, err := client.Describe(context.Background(), RequestOptions{}, "abc", DescribeRequest{Title: "feat: new thing"}); err != nil {
		t.Fatalf("describe: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	want := "describe\n-r\nabc\n-m\nfeat: new thing\n"
	if string(args) != want {
		t.Fatalf("args = %q, want %q", string(args), want)
	}
}

func TestDescribeValidation(t *testing.T) {
	client := &JJClient{repoPath: t.TempDir(), executable: "jj"}

	if _, err := client.Describe(context.Background(), RequestOptions{}, " ", DescribeRequest{Title: "title"}); err == nil {
		t.Fatal("describe with empty rev: expected error")
	}
	if _, err := client.Describe(context.Background(), RequestOptions{}, "abc", DescribeRequest{Body: "body without title"}); err == nil {
		t.Fatal("describe with body but no title: expected error")
	}
}

func TestRestorePathsRequiresRevAndPaths(t *testing.T) {
	client := &JJClient{repoPath: t.TempDir(), executable: "jj"}

	if _, err := client.RestorePaths(context.Background(), RequestOptions{}, " ", []string{"file.go"}); err == nil {
		t.Fatal("restore paths with empty rev: expected error")
	}
	if _, err := client.RestorePaths(context.Background(), RequestOptions{}, "abc", []string{" "}); err == nil {
		t.Fatal("restore paths without paths: expected error")
	}
}

func TestRestoreHunkRestoresSelectedHunkViaTool(t *testing.T) {
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "args")
	executable := filepath.Join(dir, "jj")
	restoreTool := filepath.Join(dir, "weiff-restore-tool")
	restoreScript := "#!/bin/sh\n" +
		"test \"$1\" = \"__weiff_restore_hunk\"\n" +
		"target=\"$2/$WEIFF_RESTORE_HUNK_PATH\"\n" +
		"mkdir -p \"$(dirname \"$target\")\"\n" +
		"cp \"$WEIFF_RESTORE_HUNK_CONTENT\" \"$target\"\n"
	if err := os.WriteFile(restoreTool, []byte(restoreScript), 0o755); err != nil {
		t.Fatalf("write fake restore tool: %v", err)
	}
	// The fake jj prints the current file content for `file show` and invokes
	// the configured Weiff diff editor for `restore`.
	script := "#!/bin/sh\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + shellQuote(argsPath) + "\n" +
		"done\n" +
		"case \"$1\" in\n" +
		"  file)\n" +
		"    printf 'one\\nTWO\\nthree\\n'\n" +
		"    ;;\n" +
		"  --config)\n" +
		"    right=$(mktemp -d)\n" +
		"    " + shellQuote(restoreTool) + " __weiff_restore_hunk \"$right\"\n" +
		"    cat \"$right/src/main.go\"\n" +
		"    ;;\n" +
		"esac\n"
	if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake jj: %v", err)
	}

	client := &JJClient{repoPath: dir, executable: executable, restoreTool: restoreTool}
	result, err := client.RestoreHunk(context.Background(), RequestOptions{}, "abc", HunkRestoreRequest{
		Path:     "src/main.go",
		NewStart: 1,
		Lines:    []string{" one", "-two", "+TWO", " three"},
	})
	if err != nil {
		t.Fatalf("restore hunk: %v", err)
	}

	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	if !strings.Contains(string(args), "file\nshow\n--no-pager\n--color=never\n-r\nabc\nfile:\"src/main.go\"\n") {
		t.Fatalf("args = %q, want jj file show for the target path", string(args))
	}
	if !strings.Contains(string(args), "merge-tools.weiff-restore-hunk.diff-args=[\"__weiff_restore_hunk\",\"$right\"]\nrestore\n--changes-in\nabc\n--tool\nweiff-restore-hunk\n") {
		t.Fatalf("args = %q, want jj restore with the Weiff diff editor", string(args))
	}
	if result.Message != "one\ntwo\nthree" {
		t.Fatalf("message = %q, want restored content one two three", result.Message)
	}
}

func TestReverseHunkRemovesHunkFromCurrentContent(t *testing.T) {
	restored, err := reverseHunk("one\nTWO\nthree\n", HunkRestoreRequest{
		Path:     "src/main.go",
		NewStart: 1,
		Lines:    []string{" one", "-two", "+TWO", " three"},
	})
	if err != nil {
		t.Fatalf("reverse hunk: %v", err)
	}
	if restored != "one\ntwo\nthree\n" {
		t.Fatalf("restored = %q, want original content", restored)
	}
}

func TestReverseHunkRestoresDeletedLines(t *testing.T) {
	restored, err := reverseHunk("one\nfour\n", HunkRestoreRequest{
		Path:     "src/main.go",
		NewStart: 2,
		Lines:    []string{"-two", "-three", " four"},
	})
	if err != nil {
		t.Fatalf("reverse hunk: %v", err)
	}
	if restored != "one\ntwo\nthree\nfour\n" {
		t.Fatalf("restored = %q, want deleted lines back", restored)
	}
}

func TestReverseHunkRejectsMismatchedContent(t *testing.T) {
	if _, err := reverseHunk("different\ncontent\n", HunkRestoreRequest{
		Path:     "src/main.go",
		NewStart: 1,
		Lines:    []string{" one", "+TWO"},
	}); err == nil {
		t.Fatal("reverse hunk with stale content: expected error")
	}
}

func TestReverseHunkRejectsOutOfRangeHunk(t *testing.T) {
	if _, err := reverseHunk("one\n", HunkRestoreRequest{
		Path:     "src/main.go",
		NewStart: 5,
		Lines:    []string{" one", "+TWO"},
	}); err == nil {
		t.Fatal("reverse hunk out of range: expected error")
	}
}

type fakeRevision struct {
	err          string
	commitID     string
	changeID     string
	changeOffset int
	description  string
	divergent    bool
}

func fakeRevisionScript(revisions map[string]fakeRevision) string {
	var builder strings.Builder
	builder.WriteString("#!/bin/sh\n")
	builder.WriteString("revision=\"\"\n")
	builder.WriteString("previous=\"\"\n")
	builder.WriteString("for arg in \"$@\"; do\n")
	builder.WriteString("  if [ \"$previous\" = \"--revision\" ]; then\n")
	builder.WriteString("    revision=\"$arg\"\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  previous=\"$arg\"\n")
	builder.WriteString("done\n")
	builder.WriteString("case \"$revision\" in\n")
	for rev, result := range revisions {
		builder.WriteString("  ")
		builder.WriteString(shellQuote(rev))
		builder.WriteString(")\n")
		if result.err != "" {
			builder.WriteString("    echo ")
			builder.WriteString(shellQuote(result.err))
			builder.WriteString(" >&2\n")
			builder.WriteString("    exit 1\n")
			builder.WriteString("    ;;\n")
			continue
		}
		builder.WriteString("    printf '%s\\n' ")
		builder.WriteString(shellQuote(fakeRevisionLine(rev, result)))
		builder.WriteByte('\n')
		builder.WriteString("    ;;\n")
	}
	builder.WriteString("  *)\n")
	builder.WriteString("    echo \"unknown revision $revision\" >&2\n")
	builder.WriteString("    exit 1\n")
	builder.WriteString("    ;;\n")
	builder.WriteString("esac\n")
	return builder.String()
}

func fakePinnedReadScript(argsPath string, resolvedID string, revisions map[string]fakeRevision) string {
	var builder strings.Builder
	builder.WriteString("#!/bin/sh\n")
	builder.WriteString("revision=\"\"\n")
	builder.WriteString("previous=\"\"\n")
	builder.WriteString("for arg in \"$@\"; do\n")
	builder.WriteString("  case \"$previous\" in\n")
	builder.WriteString("    --revision|-r) revision=\"$arg\" ;;\n")
	builder.WriteString("  esac\n")
	builder.WriteString("  previous=\"$arg\"\n")
	builder.WriteString("done\n")
	builder.WriteString("for arg in \"$@\"; do printf '\\t%s' \"$arg\" >> ")
	builder.WriteString(shellQuote(argsPath))
	builder.WriteString("; done\n")
	builder.WriteString("printf '\\t\\n' >> ")
	builder.WriteString(shellQuote(argsPath))
	builder.WriteByte('\n')
	builder.WriteString("if [ \"$1\" = \"log\" ]; then\n")
	builder.WriteString("  case \"$revision\" in\n")
	for rev, result := range revisions {
		builder.WriteString("    ")
		builder.WriteString(shellQuote(rev))
		builder.WriteString(")\n")
		if result.err != "" {
			builder.WriteString("      echo ")
			builder.WriteString(shellQuote(result.err))
			builder.WriteString(" >&2\n")
			builder.WriteString("      exit 1\n")
			builder.WriteString("      ;;\n")
			continue
		}
		builder.WriteString("      printf '%s\\n' ")
		builder.WriteString(shellQuote(fakeRevisionLine(rev, result)))
		builder.WriteByte('\n')
		builder.WriteString("      ;;\n")
	}
	builder.WriteString("    *)\n")
	builder.WriteString("      echo \"unknown revision $revision\" >&2\n")
	builder.WriteString("      exit 1\n")
	builder.WriteString("      ;;\n")
	builder.WriteString("  esac\n")
	builder.WriteString("  exit 0\n")
	builder.WriteString("fi\n")
	builder.WriteString("if [ \"$revision\" != ")
	builder.WriteString(shellQuote(resolvedID))
	builder.WriteString(" ]; then\n")
	builder.WriteString("  echo \"read was not pinned: $revision\" >&2\n")
	builder.WriteString("  exit 1\n")
	builder.WriteString("fi\n")
	builder.WriteString("case \"$1\" in\n")
	builder.WriteString("  diff|evolog) exit 0 ;;\n")
	builder.WriteString("  file) printf 'file content\\n'; exit 0 ;;\n")
	builder.WriteString("  *) echo \"unknown command $1\" >&2; exit 1 ;;\n")
	builder.WriteString("esac\n")
	return builder.String()
}

func fakeRevisionLine(rev string, value fakeRevision) string {
	commitID := value.commitID
	if commitID == "" {
		commitID = rev
	}
	changeID := value.changeID
	if changeID == "" {
		changeID = commitID + "change"
	}
	description := value.description
	if description == "" {
		description = commitID
	}
	encoded, err := json.Marshal(map[string]any{
		"commitId":        commitID,
		"changeId":        changeID,
		"changeOffset":    value.changeOffset,
		"description":     description,
		"authorName":      "Ada",
		"authorEmail":     "ada@example.com",
		"authorTimestamp": "2026-06-29T12:00:00Z",
		"current":         false,
		"empty":           false,
		"divergent":       value.divergent,
		"bookmarks":       []string{},
	})
	if err != nil {
		panic(err)
	}
	return "○  " + string(encoded)
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
