package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"weiff/internal/config"
	"weiff/internal/repo"
)

func newRequest(method, target string, body io.Reader) *http.Request {
	request := httptest.NewRequestWithContext(context.Background(), method, target, body)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	return request
}

func TestHandleGetConfig(t *testing.T) {
	store := newTestConfigStore(t)
	if _, err := store.Save(config.Config{
		CurrentRepository: "/tmp/repo",
		Repositories:      []config.Repository{{Path: "/tmp/repo", Name: "Main"}},
		LogRevset:         "description(feat)",
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	req := newRequest(http.MethodGet, "/api/config", nil)
	rec := httptest.NewRecorder()
	NewServer(&fakeClient{}, store).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var got config.Config
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.CurrentRepository != "/tmp/repo" || got.LogRevset != "description(feat)" {
		t.Fatalf("config = %#v", got)
	}
	if len(got.Repositories) != 1 || got.Repositories[0].Name != "Main" {
		t.Fatalf("repositories = %#v", got.Repositories)
	}
}

func TestHandlePutConfig(t *testing.T) {
	store := newTestConfigStore(t)
	req := newRequest(http.MethodPut, "/api/config", bytes.NewBufferString(`{
		"currentRepository": " /tmp/current ",
		"repositories": [
			{"path": "/tmp/other", "name": " Other "},
			{"path": "/tmp/current"}
		],
		"logRevset": " mine() "
	}`))

	rec := httptest.NewRecorder()
	NewServer(&fakeClient{}, store).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got.CurrentRepository != "/tmp/current" || got.LogRevset != "mine()" {
		t.Fatalf("saved config = %#v", got)
	}
	if len(got.Repositories) != 2 || got.Repositories[0].Path != "/tmp/current" || got.Repositories[1].Name != "Other" {
		t.Fatalf("saved repositories = %#v", got.Repositories)
	}
}

func TestHandlePutConfigValidatesJSONRequest(t *testing.T) {
	t.Parallel()

	oversized := append([]byte(`{"currentRepository":"`), bytes.Repeat([]byte("a"), maxRequestBody)...)
	oversized = append(oversized, '"', '}')
	tests := []struct {
		name        string
		body        []byte
		contentType string
		wantStatus  int
		wantCode    string
	}{
		{name: "requires JSON content type", body: []byte(`{}`), wantStatus: http.StatusUnsupportedMediaType, wantCode: "unsupported_media_type"},
		{name: "rejects unknown field", body: []byte(`{"unknown":true}`), contentType: "application/json", wantStatus: http.StatusBadRequest, wantCode: "invalid_json"},
		{name: "rejects multiple values", body: []byte(`{} {}`), contentType: "application/json", wantStatus: http.StatusBadRequest, wantCode: "invalid_json"},
		{name: "rejects oversized body", body: oversized, contentType: "application/json", wantStatus: http.StatusRequestEntityTooLarge, wantCode: "request_too_large"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			request := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(test.body))
			if test.contentType != "" {
				request.Header.Set("Content-Type", test.contentType)
			}
			recorder := httptest.NewRecorder()
			newTestServer(t, &fakeClient{}).Handler().ServeHTTP(recorder, request)

			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			var response errorResponse
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Code != test.wantCode {
				t.Fatalf("error code = %q, want %q", response.Code, test.wantCode)
			}
		})
	}
}

func TestHandleDiff(t *testing.T) {
	client := fakeClient{
		diffResult: repo.DiffResult{
			RepoPath:    "/tmp/repo",
			VCS:         "jj",
			Rev:         "abc",
			Command:     []string{"jj", "diff", "--git"},
			Diff:        "diff --git a/file b/file\n",
			GeneratedAt: time.Date(2026, 6, 17, 12, 0, 0, 0, time.UTC),
		},
	}

	req := newRequest(http.MethodGet, "/api/diff?rev=abc&commitId=def&repoPath=%2Ftmp%2Fother", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var got repo.DiffResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.RepoPath != client.diffResult.RepoPath {
		t.Fatalf("repo path = %q, want %q", got.RepoPath, client.diffResult.RepoPath)
	}
	if got.Diff != client.diffResult.Diff {
		t.Fatalf("diff = %q, want %q", got.Diff, client.diffResult.Diff)
	}
	if client.diffRev != "abc" {
		t.Fatalf("diff rev = %q, want %q", client.diffRev, "abc")
	}
	if client.diffOpts.RepoPath != "/tmp/other" {
		t.Fatalf("diff repo path = %q, want %q", client.diffOpts.RepoPath, "/tmp/other")
	}
	if client.diffOpts.CommitID != "def" {
		t.Fatalf("diff commit id = %q, want %q", client.diffOpts.CommitID, "def")
	}
	if client.diffIgnoreWhitespace {
		t.Fatal("ignore whitespace should default to false")
	}
}

func TestHandleDiffIgnoreWhitespace(t *testing.T) {
	client := fakeClient{diffResult: repo.DiffResult{RepoPath: "/tmp/repo"}}

	req := newRequest(http.MethodGet, "/api/diff?rev=abc&ignoreWhitespace=true", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !client.diffIgnoreWhitespace {
		t.Fatal("ignore whitespace not passed to client")
	}
}

func TestHandleFileContent(t *testing.T) {
	client := fakeClient{
		fileContentResult: repo.FileContentResult{
			RepoPath: "/tmp/repo",
			Rev:      "abc",
			Path:     "src/main.go",
			Content:  "package main\n",
		},
	}

	req := newRequest(http.MethodGet, "/api/file-content?rev=abc&path=src%2Fmain.go", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var got repo.FileContentResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Content != "package main\n" {
		t.Fatalf("content = %q, want %q", got.Content, "package main\n")
	}
	if client.fileContentRev != "abc" || client.fileContentPath != "src/main.go" {
		t.Fatalf("client called with rev=%q path=%q", client.fileContentRev, client.fileContentPath)
	}
}

func TestHandleFileContentRequiresPath(t *testing.T) {
	client := fakeClient{}

	req := newRequest(http.MethodGet, "/api/file-content?rev=abc", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestHandleRepositoryFiles(t *testing.T) {
	client := fakeClient{
		repositoryFilesResult: repo.RepositoryFilesResult{
			RepoPath: "/tmp/repo",
			VCS:      "jj",
			Rev:      "abc",
			Path:     "src",
			Kind:     repo.RepositoryFileKindDirectory,
			Entries: []repo.RepositoryFileEntry{
				{Name: "main.go", Path: "src/main.go", Kind: repo.RepositoryFileKindFile},
			},
		},
	}

	req := newRequest(http.MethodGet, "/api/repo/files?repoPath=%2Ftmp%2Frepo&rev=change&commitId=abc&path=src", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var got repo.RepositoryFilesResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Kind != repo.RepositoryFileKindDirectory || len(got.Entries) != 1 {
		t.Fatalf("result = %#v, want directory with one entry", got)
	}
	if client.repositoryFilesOpts.RepoPath != "/tmp/repo" || client.repositoryFilesOpts.CommitID != "abc" || client.repositoryFilesRev != "change" || client.repositoryFilesPath != "src" {
		t.Fatalf("client called with opts=%#v rev=%q path=%q", client.repositoryFilesOpts, client.repositoryFilesRev, client.repositoryFilesPath)
	}
}

func TestHandleRepositoryFilesMapsKnownErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "invalid path", err: repo.ErrInvalidRepositoryFilePath, wantStatus: http.StatusBadRequest, wantCode: "invalid_path"},
		{name: "not found", err: repo.ErrRepositoryFileNotFound, wantStatus: http.StatusNotFound, wantCode: "path_not_found"},
		{name: "listing too large", err: repo.ErrRepositoryListingTooLarge, wantStatus: http.StatusRequestEntityTooLarge, wantCode: "listing_too_large"},
		{name: "unexpected", err: errors.New("jj failed"), wantStatus: http.StatusInternalServerError, wantCode: "internal_error"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			client := fakeClient{repositoryFilesErr: test.err}
			req := newRequest(http.MethodGet, "/api/repo/files?path=src", nil)
			rec := httptest.NewRecorder()

			newTestServer(t, &client).Handler().ServeHTTP(rec, req)

			if rec.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, test.wantStatus)
			}
			var got errorResponse
			if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if got.Code != test.wantCode {
				t.Fatalf("error code = %q, want %q", got.Code, test.wantCode)
			}
		})
	}
}

func TestHandleDiffError(t *testing.T) {
	client := fakeClient{diffErr: errors.New("jj failed")}

	req := newRequest(http.MethodGet, "/api/diff", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}

	var got errorResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Error != "internal server error" || got.Code != "internal_error" {
		t.Fatalf("error = %#v", got)
	}
}

func TestHandleDiffDeadlineExceeded(t *testing.T) {
	client := fakeClient{diffErr: context.DeadlineExceeded}
	req := newRequest(http.MethodGet, "/api/diff", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusGatewayTimeout)
	}
	var got errorResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Error != "internal server error" || got.Code != "timeout" {
		t.Fatalf("error = %#v", got)
	}
}

func TestHandleEvolutionLog(t *testing.T) {
	client := fakeClient{
		evolutionResult: repo.EvolutionLogResult{
			RepoPath: "/tmp/repo",
			VCS:      "jj",
			Rev:      "change",
			Entries: []repo.EvolutionEntry{
				{
					CommitID:         "abc",
					ShortCommitID:    "abc",
					OperationID:      "op",
					ShortOperationID: "op",
					FilesChanged:     2,
				},
			},
			GeneratedAt: time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC),
		},
	}

	req := newRequest(http.MethodGet, "/api/evolution-log?rev=change&limit=12&repoPath=%2Ftmp%2Fother", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.evolutionRev != "change" {
		t.Fatalf("evolution rev = %q, want %q", client.evolutionRev, "change")
	}
	if client.evolutionLimit != 12 {
		t.Fatalf("evolution limit = %d, want %d", client.evolutionLimit, 12)
	}
	if client.evolutionOpts.RepoPath != "/tmp/other" {
		t.Fatalf("evolution repo path = %q, want %q", client.evolutionOpts.RepoPath, "/tmp/other")
	}

	var got repo.EvolutionLogResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got.Entries) != 1 || got.Entries[0].CommitID != "abc" {
		t.Fatalf("entries = %+v, want abc entry", got.Entries)
	}
}

func TestHandleEvolutionLogCanceledRequestDoesNotWriteResponse(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	client := fakeClient{evolutionErr: context.Canceled}
	req := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/evolution-log?rev=change", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Body.Len() != 0 {
		t.Fatalf("response body = %q, want no response for canceled request", rec.Body.String())
	}
	if contentType := rec.Header().Get("Content-Type"); contentType != "" {
		t.Fatalf("Content-Type = %q, want empty", contentType)
	}
}

func TestHandleEvolutionDiff(t *testing.T) {
	client := fakeClient{
		evolutionDiffResult: repo.DiffResult{
			RepoPath:    "/tmp/repo",
			VCS:         "jj",
			Rev:         "abc",
			Command:     []string{"jj", "evolog"},
			Diff:        "diff --git a/file b/file\n+new line\n",
			GeneratedAt: time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC),
		},
	}

	req := newRequest(http.MethodGet, "/api/evolution-diff?rev=change&commitId=abc&repoPath=%2Ftmp%2Fother", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.evolutionDiffRev != "change" {
		t.Fatalf("evolution diff rev = %q, want %q", client.evolutionDiffRev, "change")
	}
	if client.evolutionDiffCommitID != "abc" {
		t.Fatalf("evolution diff commit = %q, want %q", client.evolutionDiffCommitID, "abc")
	}
	if client.evolutionDiffOpts.RepoPath != "/tmp/other" {
		t.Fatalf("evolution diff repo path = %q, want %q", client.evolutionDiffOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleState(t *testing.T) {
	client := fakeClient{
		stateResult: repo.StateResult{
			RepoPath:        "/tmp/repo",
			VCS:             "jj",
			CurrentCommitID: "abc",
			Commits:         []repo.Commit{{CommitID: "abc", Current: true}},
			GeneratedAt:     time.Date(2026, 6, 17, 12, 0, 0, 0, time.UTC),
		},
	}

	req := newRequest(http.MethodGet, "/api/state?limit=25&repoPath=%2Ftmp%2Fother&revset=description%28feat%29", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.stateLimit != 25 {
		t.Fatalf("state limit = %d, want %d", client.stateLimit, 25)
	}
	if client.stateOpts.RepoPath != "/tmp/other" {
		t.Fatalf("state repo path = %q, want %q", client.stateOpts.RepoPath, "/tmp/other")
	}
	if client.stateOpts.Revset != "description(feat)" {
		t.Fatalf("state revset = %q, want %q", client.stateOpts.Revset, "description(feat)")
	}
	if bytes.Contains(rec.Body.Bytes(), []byte(`"parents"`)) ||
		bytes.Contains(rec.Body.Bytes(), []byte(`"parentChangeIds"`)) {
		t.Fatalf("response contains commit parent ids: %s", rec.Body.String())
	}

	var got repo.StateResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.CurrentCommitID != "abc" {
		t.Fatalf("current commit = %q, want %q", got.CurrentCommitID, "abc")
	}
}

func TestHandleCommit(t *testing.T) {
	client := fakeClient{
		commitResult: repo.CommitResult{
			RepoPath: "/tmp/repo",
			VCS:      "jj",
			Rev:      "remotecommit",
			Commit: repo.Commit{
				CommitID:      "remotecommit",
				ShortCommitID: "remotecommit",
				ChangeID:      "remotechange",
				ShortChangeID: "remotechange",
				Summary:       "remote work",
			},
			GeneratedAt: time.Date(2026, 6, 29, 12, 0, 0, 0, time.UTC),
		},
	}

	req := newRequest(http.MethodGet, "/api/commit?rev=remotechange&commitId=remotecommit&repoPath=%2Ftmp%2Fother", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.commitRev != "remotechange" {
		t.Fatalf("commit rev = %q, want %q", client.commitRev, "remotechange")
	}
	if client.commitOpts.RepoPath != "/tmp/other" {
		t.Fatalf("commit repo path = %q, want %q", client.commitOpts.RepoPath, "/tmp/other")
	}
	if client.commitOpts.CommitID != "remotecommit" {
		t.Fatalf("commit id = %q, want %q", client.commitOpts.CommitID, "remotecommit")
	}
	if bytes.Contains(rec.Body.Bytes(), []byte(`"parents"`)) ||
		bytes.Contains(rec.Body.Bytes(), []byte(`"parentChangeIds"`)) {
		t.Fatalf("response contains commit parent ids: %s", rec.Body.String())
	}

	var got repo.CommitResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Commit.ChangeID != "remotechange" {
		t.Fatalf("commit change id = %q, want remotechange", got.Commit.ChangeID)
	}
}

func TestHandleBookmarks(t *testing.T) {
	client := fakeClient{
		bookmarksResult: repo.BookmarksResult{
			RepoPath: "/tmp/repo",
			VCS:      "jj",
			Bookmarks: []repo.Bookmark{
				{Name: "main", Target: "abc", ShortTarget: "abc", Present: true},
			},
			GeneratedAt: time.Date(2026, 6, 29, 12, 0, 0, 0, time.UTC),
		},
	}

	req := newRequest(http.MethodGet, "/api/bookmarks?repoPath=%2Ftmp%2Fother", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.bookmarksOpts.RepoPath != "/tmp/other" {
		t.Fatalf("bookmarks repo path = %q, want %q", client.bookmarksOpts.RepoPath, "/tmp/other")
	}

	var got repo.BookmarksResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got.Bookmarks) != 1 || got.Bookmarks[0].Name != "main" {
		t.Fatalf("bookmarks = %+v, want main bookmark", got.Bookmarks)
	}
}

func TestHandleWorkspaces(t *testing.T) {
	client := fakeClient{
		workspacesResult: repo.WorkspacesResult{
			RepoPath: "/tmp/repo",
			VCS:      "jj",
			Workspaces: []repo.Workspace{
				{Name: "default", Root: "/tmp/repo", Target: "abc", ShortTarget: "abc", Current: true},
			},
			GeneratedAt: time.Date(2026, 6, 29, 12, 0, 0, 0, time.UTC),
		},
	}

	req := newRequest(http.MethodGet, "/api/workspaces?repoPath=%2Ftmp%2Fother", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.workspacesOpts.RepoPath != "/tmp/other" {
		t.Fatalf("workspaces repo path = %q, want %q", client.workspacesOpts.RepoPath, "/tmp/other")
	}

	var got repo.WorkspacesResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got.Workspaces) != 1 || got.Workspaces[0].Name != "default" {
		t.Fatalf("workspaces = %+v, want default workspace", got.Workspaces)
	}
}

func TestHandleOperations(t *testing.T) {
	client := fakeClient{
		operationsResult: repo.OperationLogResult{
			RepoPath: "/tmp/repo",
			VCS:      "jj",
			Operations: []repo.OperationEntry{
				{
					ID:          "abc",
					ShortID:     "abc",
					Description: "snapshot working copy",
					User:        "ada@example.com",
					Current:     true,
				},
			},
			GeneratedAt: time.Date(2026, 6, 29, 12, 0, 0, 0, time.UTC),
		},
	}

	req := newRequest(http.MethodGet, "/api/operations?limit=12&repoPath=%2Ftmp%2Fother", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.operationsLimit != 12 {
		t.Fatalf("operations limit = %d, want %d", client.operationsLimit, 12)
	}
	if client.operationsOpts.RepoPath != "/tmp/other" {
		t.Fatalf("operations repo path = %q, want %q", client.operationsOpts.RepoPath, "/tmp/other")
	}

	var got repo.OperationLogResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got.Operations) != 1 || got.Operations[0].ID != "abc" {
		t.Fatalf("operations = %+v, want abc operation", got.Operations)
	}
}

func TestHandleOperationsWithoutLimit(t *testing.T) {
	client := fakeClient{}
	req := newRequest(http.MethodGet, "/api/operations?repoPath=%2Ftmp%2Fother", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.operationsLimit != 50 {
		t.Fatalf("operations limit = %d, want default 50", client.operationsLimit)
	}
	if client.operationsOpts.RepoPath != "/tmp/other" {
		t.Fatalf("operations repo path = %q, want %q", client.operationsOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleRestoreOperation(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "restored"}}
	req := newRequest(http.MethodPost, "/api/operations/abc123/restore", bytes.NewBufferString(`{"repoPath":"/tmp/repo"}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.restoredOperationID != "abc123" {
		t.Fatalf("restored operation id = %q, want abc123", client.restoredOperationID)
	}
	if client.restoreOperationOpts.RepoPath != "/tmp/repo" {
		t.Fatalf("restore repo path = %q, want %q", client.restoreOperationOpts.RepoPath, "/tmp/repo")
	}
}

func TestHandleUndoLastOperation(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "undone"}}
	req := newRequest(http.MethodPost, "/api/operations/undo", bytes.NewBufferString(`{"repoPath":"/tmp/repo"}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !client.undoLastOperationCalled {
		t.Fatalf("undo last operation was not called")
	}
	if client.undoLastOperationOpts.RepoPath != "/tmp/repo" {
		t.Fatalf("undo repo path = %q, want %q", client.undoLastOperationOpts.RepoPath, "/tmp/repo")
	}
}

func TestUnknownAPIRouteDoesNotFallBackToFrontend(t *testing.T) {
	req := newRequest(http.MethodGet, "/api/missing", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &fakeClient{}).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestHandleFrontendDoesNotCatchUnknownAPI(t *testing.T) {
	req := newRequest(http.MethodGet, "/api/not-found", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &fakeClient{}).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestHandleCheckout(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "checked out"}}
	req := newRequest(http.MethodPost, "/api/checkout", bytes.NewBufferString(`{"rev":"abc","repoPath":"/tmp/other"}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.checkoutRev != "abc" {
		t.Fatalf("checkout rev = %q, want %q", client.checkoutRev, "abc")
	}
	if client.checkoutOpts.RepoPath != "/tmp/other" {
		t.Fatalf("checkout repo path = %q, want %q", client.checkoutOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleNewFrom(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "created"}}
	req := newRequest(http.MethodPost, "/api/changes/new", bytes.NewBufferString(`{"rev":"abc","repoPath":"/tmp/other"}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.newFromRev != "abc" {
		t.Fatalf("new rev = %q, want %q", client.newFromRev, "abc")
	}
	if client.newFromOpts.RepoPath != "/tmp/other" {
		t.Fatalf("new repo path = %q, want %q", client.newFromOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleDescribe(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "described"}}
	req := newRequest(http.MethodPost, "/api/changes/describe", bytes.NewBufferString(`{"rev":"abc","repoPath":"/tmp/other","title":"feat: new thing","body":"longer explanation"}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.describeRev != "abc" {
		t.Fatalf("describe rev = %q, want %q", client.describeRev, "abc")
	}
	if client.describeReq.Title != "feat: new thing" {
		t.Fatalf("describe title = %q, want %q", client.describeReq.Title, "feat: new thing")
	}
	if client.describeReq.Body != "longer explanation" {
		t.Fatalf("describe body = %q, want %q", client.describeReq.Body, "longer explanation")
	}
	if client.describeOpts.RepoPath != "/tmp/other" {
		t.Fatalf("describe repo path = %q, want %q", client.describeOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleAbandon(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "abandoned"}}
	req := newRequest(http.MethodPost, "/api/changes/abandon", bytes.NewBufferString(`{"rev":"abc","repoPath":"/tmp/other"}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.abandonRev != "abc" {
		t.Fatalf("abandon rev = %q, want %q", client.abandonRev, "abc")
	}
	if client.abandonOpts.RepoPath != "/tmp/other" {
		t.Fatalf("abandon repo path = %q, want %q", client.abandonOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleRebase(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "rebased"}}
	req := newRequest(http.MethodPost, "/api/changes/rebase", bytes.NewBufferString(`{"rev":"abc","repoPath":"/tmp/other"}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.rebaseRev != "abc" {
		t.Fatalf("rebase rev = %q, want %q", client.rebaseRev, "abc")
	}
	if client.rebaseOpts.RepoPath != "/tmp/other" {
		t.Fatalf("rebase repo path = %q, want %q", client.rebaseOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleRestorePaths(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "restored"}}
	req := newRequest(http.MethodPost, "/api/changes/restore-paths", bytes.NewBufferString(`{"rev":"abc","repoPath":"/tmp/other","paths":["src/main.go","docs/readme.md"]}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.restorePathsRev != "abc" {
		t.Fatalf("restore rev = %q, want %q", client.restorePathsRev, "abc")
	}
	if len(client.restoredPaths) != 2 || client.restoredPaths[0] != "src/main.go" || client.restoredPaths[1] != "docs/readme.md" {
		t.Fatalf("restored paths = %#v, want [src/main.go docs/readme.md]", client.restoredPaths)
	}
	if client.restorePathsOpts.RepoPath != "/tmp/other" {
		t.Fatalf("restore repo path = %q, want %q", client.restorePathsOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleRestoreHunk(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "restored"}}
	req := newRequest(http.MethodPost, "/api/changes/restore-hunk", bytes.NewBufferString(`{"rev":"abc","repoPath":"/tmp/other","path":"src/main.go","newStart":3,"lines":[" ctx","+added","-removed"]}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.restoreHunkRev != "abc" {
		t.Fatalf("restore hunk rev = %q, want %q", client.restoreHunkRev, "abc")
	}
	if client.restoreHunkReq.Path != "src/main.go" {
		t.Fatalf("restore hunk path = %q, want %q", client.restoreHunkReq.Path, "src/main.go")
	}
	if client.restoreHunkReq.NewStart != 3 {
		t.Fatalf("restore hunk new start = %d, want 3", client.restoreHunkReq.NewStart)
	}
	if len(client.restoreHunkReq.Lines) != 3 {
		t.Fatalf("restore hunk lines = %#v, want 3 lines", client.restoreHunkReq.Lines)
	}
	if client.restoreHunkOpts.RepoPath != "/tmp/other" {
		t.Fatalf("restore hunk repo path = %q, want %q", client.restoreHunkOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleFetch(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "fetched"}}
	req := newRequest(http.MethodPost, "/api/repo/fetch", bytes.NewBufferString(`{"repoPath":"/tmp/other"}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.fetchOpts.RepoPath != "/tmp/other" {
		t.Fatalf("fetch repo path = %q, want %q", client.fetchOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleSetBookmark(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "updated"}}
	req := newRequest(http.MethodPut, "/api/bookmarks/feature%2Fui", bytes.NewBufferString(`{"rev":"abc","repoPath":"/tmp/other","allowBackwards":true}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.bookmarkReq.Name != "feature/ui" {
		t.Fatalf("bookmark name = %q, want %q", client.bookmarkReq.Name, "feature/ui")
	}
	if client.bookmarkReq.Rev != "abc" {
		t.Fatalf("bookmark rev = %q, want %q", client.bookmarkReq.Rev, "abc")
	}
	if client.bookmarkOpts.RepoPath != "/tmp/other" {
		t.Fatalf("bookmark repo path = %q, want %q", client.bookmarkOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleDeleteBookmark(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "deleted"}}
	req := newRequest(http.MethodDelete, "/api/bookmarks/feature%2Fui?repoPath=%2Ftmp%2Fother", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.deletedBookmark != "feature/ui" {
		t.Fatalf("deleted bookmark = %q, want %q", client.deletedBookmark, "feature/ui")
	}
	if client.deleteOpts.RepoPath != "/tmp/other" {
		t.Fatalf("delete repo path = %q, want %q", client.deleteOpts.RepoPath, "/tmp/other")
	}
}

func TestHandlePushBookmark(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "pushed"}}
	req := newRequest(http.MethodPost, "/api/bookmarks/feature%2Fui/push", bytes.NewBufferString(`{"repoPath":"/tmp/other","remote":"upstream","allowNew":true}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.pushReq.Name != "feature/ui" {
		t.Fatalf("pushed bookmark = %q, want %q", client.pushReq.Name, "feature/ui")
	}
	if client.pushReq.Remote != "upstream" {
		t.Fatalf("push remote = %q, want %q", client.pushReq.Remote, "upstream")
	}
	if !client.pushReq.AllowNew {
		t.Fatal("push allowNew = false, want true")
	}
	if client.pushOpts.RepoPath != "/tmp/other" {
		t.Fatalf("push repo path = %q, want %q", client.pushOpts.RepoPath, "/tmp/other")
	}
}

func TestHandlePushTag(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "pushed"}}
	req := newRequest(http.MethodPost, "/api/tags/v1.0.0/push", bytes.NewBufferString(`{"repoPath":"/tmp/other","remote":"upstream"}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.pushTagReq.Name != "v1.0.0" {
		t.Fatalf("pushed tag = %q, want %q", client.pushTagReq.Name, "v1.0.0")
	}
	if client.pushTagReq.Remote != "upstream" {
		t.Fatalf("push tag remote = %q, want %q", client.pushTagReq.Remote, "upstream")
	}
	if client.pushTagOpts.RepoPath != "/tmp/other" {
		t.Fatalf("push tag repo path = %q, want %q", client.pushTagOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleTags(t *testing.T) {
	client := fakeClient{
		tagsResult: repo.TagsResult{
			RepoPath:    "/tmp/repo",
			VCS:         "jj",
			Tags:        []repo.Tag{{Name: "v1.0.0", Target: "abc", ShortTarget: "abc", Present: true}},
			GeneratedAt: time.Date(2026, 6, 29, 12, 0, 0, 0, time.UTC),
		},
	}

	req := newRequest(http.MethodGet, "/api/tags?repoPath=%2Ftmp%2Fother", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.tagsOpts.RepoPath != "/tmp/other" {
		t.Fatalf("tags repo path = %q, want %q", client.tagsOpts.RepoPath, "/tmp/other")
	}

	var got repo.TagsResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got.Tags) != 1 || got.Tags[0].Name != "v1.0.0" {
		t.Fatalf("tags = %+v, want v1.0.0 tag", got.Tags)
	}
}

func TestHandleSetTag(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "updated"}}
	req := newRequest(http.MethodPut, "/api/tags/v1.0.0", bytes.NewBufferString(`{"rev":"abc","repoPath":"/tmp/other","allowMove":true}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.tagReq.Name != "v1.0.0" {
		t.Fatalf("tag name = %q, want %q", client.tagReq.Name, "v1.0.0")
	}
	if client.tagReq.Rev != "abc" {
		t.Fatalf("tag rev = %q, want %q", client.tagReq.Rev, "abc")
	}
	if !client.tagReq.AllowMove {
		t.Fatal("tag allowMove = false, want true")
	}
	if client.tagOpts.RepoPath != "/tmp/other" {
		t.Fatalf("tag repo path = %q, want %q", client.tagOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleDeleteTag(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "deleted"}}
	req := newRequest(http.MethodDelete, "/api/tags/v1.0.0?repoPath=%2Ftmp%2Fother", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.deletedTag != "v1.0.0" {
		t.Fatalf("deleted tag = %q, want %q", client.deletedTag, "v1.0.0")
	}
	if client.deleteTagOpts.RepoPath != "/tmp/other" {
		t.Fatalf("delete repo path = %q, want %q", client.deleteTagOpts.RepoPath, "/tmp/other")
	}
}

func TestHandleRemotes(t *testing.T) {
	client := fakeClient{
		remotesResult: repo.RemotesResult{
			RepoPath: "/tmp/repo",
			VCS:      "jj",
			Remotes: []repo.Remote{
				{Name: "origin", URL: "git@github.com:me/repo.git"},
				{Name: "upstream", URL: "https://github.com/them/repo.git"},
			},
		},
	}
	req := newRequest(http.MethodGet, "/api/remotes?repoPath=%2Ftmp%2Fother", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.remotesOpts.RepoPath != "/tmp/other" {
		t.Fatalf("remotes repo path = %q, want %q", client.remotesOpts.RepoPath, "/tmp/other")
	}

	var got repo.RemotesResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got.Remotes) != 2 || got.Remotes[0].Name != "origin" || got.Remotes[1].Name != "upstream" {
		t.Fatalf("remotes = %+v, want origin and upstream", got.Remotes)
	}
}

func TestHandleAddWorkspace(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "created"}}
	req := newRequest(http.MethodPost, "/api/workspaces", bytes.NewBufferString(`{"destination":"/tmp/work","name":"work","rev":"abc","message":"start work","sparsePatterns":"full","repoPath":"/tmp/repo"}`))
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.workspaceReq.Destination != "/tmp/work" {
		t.Fatalf("workspace destination = %q, want %q", client.workspaceReq.Destination, "/tmp/work")
	}
	if client.workspaceReq.Name != "work" {
		t.Fatalf("workspace name = %q, want %q", client.workspaceReq.Name, "work")
	}
	if client.workspaceReq.Rev != "abc" {
		t.Fatalf("workspace rev = %q, want %q", client.workspaceReq.Rev, "abc")
	}
	if client.workspaceReq.SparsePatterns != "full" {
		t.Fatalf("workspace sparse patterns = %q, want full", client.workspaceReq.SparsePatterns)
	}
	if client.workspaceOpts.RepoPath != "/tmp/repo" {
		t.Fatalf("workspace repo path = %q, want %q", client.workspaceOpts.RepoPath, "/tmp/repo")
	}
}

func TestHandleForgetWorkspace(t *testing.T) {
	client := fakeClient{commandResult: repo.CommandResult{Message: "forgotten"}}
	req := newRequest(http.MethodDelete, "/api/workspaces/feature%2Fwork?repoPath=%2Ftmp%2Frepo", nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &client).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if client.forgottenWorkspace != "feature/work" {
		t.Fatalf("forgotten workspace = %q, want %q", client.forgottenWorkspace, "feature/work")
	}
	if client.forgetWorkspaceOpts.RepoPath != "/tmp/repo" {
		t.Fatalf("forget workspace repo path = %q, want %q", client.forgetWorkspaceOpts.RepoPath, "/tmp/repo")
	}
}

func newTestServer(t *testing.T, client repo.Client) *Server {
	t.Helper()
	return NewServer(client, newTestConfigStore(t))
}

func newTestConfigStore(t *testing.T) *config.Store {
	t.Helper()
	store, err := config.NewStore(filepath.Join(t.TempDir(), "config"))
	if err != nil {
		t.Fatalf("config.NewStore() error = %v", err)
	}
	return store
}

type fakeClient struct {
	stateResult             repo.StateResult
	stateOpts               repo.RequestOptions
	stateLimit              int
	commitResult            repo.CommitResult
	commitOpts              repo.RequestOptions
	commitRev               string
	bookmarksResult         repo.BookmarksResult
	bookmarksOpts           repo.RequestOptions
	workspacesResult        repo.WorkspacesResult
	workspacesOpts          repo.RequestOptions
	operationsResult        repo.OperationLogResult
	operationsOpts          repo.RequestOptions
	operationsLimit         int
	restoreOperationOpts    repo.RequestOptions
	restoredOperationID     string
	undoLastOperationOpts   repo.RequestOptions
	undoLastOperationCalled bool
	diffResult              repo.DiffResult
	diffOpts                repo.RequestOptions
	diffRev                 string
	diffIgnoreWhitespace    bool
	diffErr                 error
	fileContentResult       repo.FileContentResult
	fileContentOpts         repo.RequestOptions
	fileContentRev          string
	fileContentPath         string
	repositoryFilesResult   repo.RepositoryFilesResult
	repositoryFilesErr      error
	repositoryFilesOpts     repo.RequestOptions
	repositoryFilesRev      string
	repositoryFilesPath     string
	evolutionResult         repo.EvolutionLogResult
	evolutionErr            error
	evolutionOpts           repo.RequestOptions
	evolutionRev            string
	evolutionLimit          int
	evolutionDiffResult     repo.DiffResult
	evolutionDiffOpts       repo.RequestOptions
	evolutionDiffRev        string
	evolutionDiffCommitID   string
	commandResult           repo.CommandResult
	checkoutOpts            repo.RequestOptions
	checkoutRev             string
	newFromOpts             repo.RequestOptions
	newFromRev              string
	describeOpts            repo.RequestOptions
	describeRev             string
	describeReq             repo.DescribeRequest
	abandonOpts             repo.RequestOptions
	abandonRev              string
	rebaseOpts              repo.RequestOptions
	rebaseRev               string
	restorePathsOpts        repo.RequestOptions
	restorePathsRev         string
	restoredPaths           []string
	restoreHunkOpts         repo.RequestOptions
	restoreHunkRev          string
	restoreHunkReq          repo.HunkRestoreRequest
	fetchOpts               repo.RequestOptions
	bookmarkOpts            repo.RequestOptions
	bookmarkReq             repo.BookmarkRequest
	deleteOpts              repo.RequestOptions
	deletedBookmark         string
	pushOpts                repo.RequestOptions
	pushReq                 repo.PushBookmarkRequest
	tagsResult              repo.TagsResult
	tagsOpts                repo.RequestOptions
	tagOpts                 repo.RequestOptions
	tagReq                  repo.TagRequest
	deleteTagOpts           repo.RequestOptions
	deletedTag              string
	pushTagOpts             repo.RequestOptions
	pushTagReq              repo.PushTagRequest
	remotesOpts             repo.RequestOptions
	remotesResult           repo.RemotesResult
	workspaceOpts           repo.RequestOptions
	workspaceReq            repo.WorkspaceRequest
	forgetWorkspaceOpts     repo.RequestOptions
	forgottenWorkspace      string
}

func (f *fakeClient) State(_ context.Context, opts repo.RequestOptions, limit int) (repo.StateResult, error) {
	f.stateOpts = opts
	f.stateLimit = limit
	return f.stateResult, nil
}

func (f *fakeClient) Commit(_ context.Context, opts repo.RequestOptions, rev string) (repo.CommitResult, error) {
	f.commitOpts = opts
	f.commitRev = rev
	return f.commitResult, nil
}

func (f *fakeClient) Bookmarks(_ context.Context, opts repo.RequestOptions) (repo.BookmarksResult, error) {
	f.bookmarksOpts = opts
	return f.bookmarksResult, nil
}

func (f *fakeClient) Workspaces(_ context.Context, opts repo.RequestOptions) (repo.WorkspacesResult, error) {
	f.workspacesOpts = opts
	return f.workspacesResult, nil
}

func (f *fakeClient) OperationLog(_ context.Context, opts repo.RequestOptions, limit int) (repo.OperationLogResult, error) {
	f.operationsOpts = opts
	f.operationsLimit = limit
	return f.operationsResult, nil
}

func (f *fakeClient) RestoreOperation(_ context.Context, opts repo.RequestOptions, operationID string) (repo.CommandResult, error) {
	f.restoreOperationOpts = opts
	f.restoredOperationID = operationID
	return f.commandResult, nil
}

func (f *fakeClient) UndoLastOperation(_ context.Context, opts repo.RequestOptions) (repo.CommandResult, error) {
	f.undoLastOperationOpts = opts
	f.undoLastOperationCalled = true
	return f.commandResult, nil
}

func (f *fakeClient) Diff(_ context.Context, opts repo.RequestOptions, rev string, ignoreWhitespace bool) (repo.DiffResult, error) {
	f.diffOpts = opts
	f.diffRev = rev
	f.diffIgnoreWhitespace = ignoreWhitespace
	return f.diffResult, f.diffErr
}

func (f *fakeClient) FileContent(_ context.Context, opts repo.RequestOptions, rev string, path string) (repo.FileContentResult, error) {
	f.fileContentOpts = opts
	f.fileContentRev = rev
	f.fileContentPath = path
	return f.fileContentResult, nil
}

func (f *fakeClient) RepositoryFiles(_ context.Context, opts repo.RequestOptions, rev string, path string) (repo.RepositoryFilesResult, error) {
	f.repositoryFilesOpts = opts
	f.repositoryFilesRev = rev
	f.repositoryFilesPath = path
	return f.repositoryFilesResult, f.repositoryFilesErr
}

func (f *fakeClient) EvolutionLog(_ context.Context, opts repo.RequestOptions, rev string, limit int) (repo.EvolutionLogResult, error) {
	f.evolutionOpts = opts
	f.evolutionRev = rev
	f.evolutionLimit = limit
	return f.evolutionResult, f.evolutionErr
}

func (f *fakeClient) EvolutionDiff(_ context.Context, opts repo.RequestOptions, rev string, commitID string) (repo.DiffResult, error) {
	f.evolutionDiffOpts = opts
	f.evolutionDiffRev = rev
	f.evolutionDiffCommitID = commitID
	return f.evolutionDiffResult, nil
}

func (f *fakeClient) Checkout(_ context.Context, opts repo.RequestOptions, rev string) (repo.CommandResult, error) {
	f.checkoutOpts = opts
	f.checkoutRev = rev
	return f.commandResult, nil
}

func (f *fakeClient) NewFrom(_ context.Context, opts repo.RequestOptions, rev string) (repo.CommandResult, error) {
	f.newFromOpts = opts
	f.newFromRev = rev
	return f.commandResult, nil
}

func (f *fakeClient) Describe(_ context.Context, opts repo.RequestOptions, rev string, req repo.DescribeRequest) (repo.CommandResult, error) {
	f.describeOpts = opts
	f.describeRev = rev
	f.describeReq = req
	return f.commandResult, nil
}

func (f *fakeClient) Abandon(_ context.Context, opts repo.RequestOptions, rev string) (repo.CommandResult, error) {
	f.abandonOpts = opts
	f.abandonRev = rev
	return f.commandResult, nil
}

func (f *fakeClient) Rebase(_ context.Context, opts repo.RequestOptions, rev string) (repo.CommandResult, error) {
	f.rebaseOpts = opts
	f.rebaseRev = rev
	return f.commandResult, nil
}

func (f *fakeClient) RestorePaths(_ context.Context, opts repo.RequestOptions, rev string, paths []string) (repo.CommandResult, error) {
	f.restorePathsOpts = opts
	f.restorePathsRev = rev
	f.restoredPaths = paths
	return f.commandResult, nil
}

func (f *fakeClient) RestoreHunk(_ context.Context, opts repo.RequestOptions, rev string, req repo.HunkRestoreRequest) (repo.CommandResult, error) {
	f.restoreHunkOpts = opts
	f.restoreHunkRev = rev
	f.restoreHunkReq = req
	return f.commandResult, nil
}

func (f *fakeClient) Fetch(_ context.Context, opts repo.RequestOptions) (repo.CommandResult, error) {
	f.fetchOpts = opts
	return f.commandResult, nil
}

func (f *fakeClient) SetBookmark(_ context.Context, opts repo.RequestOptions, req repo.BookmarkRequest) (repo.CommandResult, error) {
	f.bookmarkOpts = opts
	f.bookmarkReq = req
	return f.commandResult, nil
}

func (f *fakeClient) DeleteBookmark(_ context.Context, opts repo.RequestOptions, name string) (repo.CommandResult, error) {
	f.deleteOpts = opts
	f.deletedBookmark = name
	return f.commandResult, nil
}

func (f *fakeClient) PushBookmark(_ context.Context, opts repo.RequestOptions, req repo.PushBookmarkRequest) (repo.CommandResult, error) {
	f.pushOpts = opts
	f.pushReq = req
	return f.commandResult, nil
}

func (f *fakeClient) Tags(_ context.Context, opts repo.RequestOptions) (repo.TagsResult, error) {
	f.tagsOpts = opts
	return f.tagsResult, nil
}

func (f *fakeClient) SetTag(_ context.Context, opts repo.RequestOptions, req repo.TagRequest) (repo.CommandResult, error) {
	f.tagOpts = opts
	f.tagReq = req
	return f.commandResult, nil
}

func (f *fakeClient) DeleteTag(_ context.Context, opts repo.RequestOptions, name string) (repo.CommandResult, error) {
	f.deleteTagOpts = opts
	f.deletedTag = name
	return f.commandResult, nil
}

func (f *fakeClient) PushTag(_ context.Context, opts repo.RequestOptions, req repo.PushTagRequest) (repo.CommandResult, error) {
	f.pushTagOpts = opts
	f.pushTagReq = req
	return f.commandResult, nil
}

func (f *fakeClient) Remotes(_ context.Context, opts repo.RequestOptions) (repo.RemotesResult, error) {
	f.remotesOpts = opts
	return f.remotesResult, nil
}

func (f *fakeClient) AddWorkspace(_ context.Context, opts repo.RequestOptions, req repo.WorkspaceRequest) (repo.CommandResult, error) {
	f.workspaceOpts = opts
	f.workspaceReq = req
	return f.commandResult, nil
}

func (f *fakeClient) ForgetWorkspace(_ context.Context, opts repo.RequestOptions, name string) (repo.CommandResult, error) {
	f.forgetWorkspaceOpts = opts
	f.forgottenWorkspace = name
	return f.commandResult, nil
}
