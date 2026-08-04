package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"weiff/internal/config"
	"weiff/internal/repo"
)

const maxRequestBody = 1 << 20

type Server struct {
	client      repo.Client
	configStore *config.Store
}

func NewServer(client repo.Client, configStore *config.Store) *Server {
	return &Server{client: client, configStore: configStore}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/config", s.handleGetConfig)
	mux.HandleFunc("PUT /api/config", s.handlePutConfig)
	mux.HandleFunc("GET /api/state", s.handleState)
	mux.HandleFunc("GET /api/commit", s.handleCommit)
	mux.HandleFunc("GET /api/bookmarks", s.handleBookmarks)
	mux.HandleFunc("GET /api/remotes", s.handleRemotes)
	mux.HandleFunc("GET /api/workspaces", s.handleWorkspaces)
	mux.HandleFunc("GET /api/operations", s.handleOperations)
	mux.HandleFunc("POST /api/operations/undo", s.handleUndoLastOperation)
	mux.HandleFunc("POST /api/operations/", s.handleRestoreOperation)
	mux.HandleFunc("GET /api/diff", s.handleDiff)
	mux.HandleFunc("GET /api/file-content", s.handleFileContent)
	mux.HandleFunc("GET /api/repo/files", s.handleRepositoryFiles)
	mux.HandleFunc("GET /api/evolution-log", s.handleEvolutionLog)
	mux.HandleFunc("GET /api/evolution-diff", s.handleEvolutionDiff)
	mux.HandleFunc("POST /api/checkout", s.handleCheckout)
	mux.HandleFunc("POST /api/changes/new", s.handleNewFrom)
	mux.HandleFunc("POST /api/changes/describe", s.handleDescribe)
	mux.HandleFunc("POST /api/changes/abandon", s.handleAbandon)
	mux.HandleFunc("POST /api/changes/rebase", s.handleRebase)
	mux.HandleFunc("POST /api/changes/restore-paths", s.handleRestorePaths)
	mux.HandleFunc("POST /api/changes/restore-hunk", s.handleRestoreHunk)
	mux.HandleFunc("POST /api/repo/fetch", s.handleFetch)
	mux.HandleFunc("POST /api/bookmarks", s.handleSetBookmark)
	mux.HandleFunc("POST /api/bookmarks/", s.handlePushBookmark)
	mux.HandleFunc("PUT /api/bookmarks/", s.handleSetBookmark)
	mux.HandleFunc("DELETE /api/bookmarks/", s.handleDeleteBookmark)
	mux.HandleFunc("POST /api/workspaces", s.handleAddWorkspace)
	mux.HandleFunc("DELETE /api/workspaces/", s.handleForgetWorkspace)
	mux.HandleFunc("GET /api/browse/dirs", s.handleBrowseDirs)
	mux.HandleFunc("GET /api/health", handleHealth)
	return mux
}

func (s *Server) handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	value, err := s.configStore.Load()
	if err != nil {
		slog.Error("load config failed", slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, value)
}

func (s *Server) handlePutConfig(w http.ResponseWriter, r *http.Request) {
	var value config.Config
	if err := decodeRequest(r, &value); err != nil {
		writeRequestError(w, err)
		return
	}
	saved, err := s.configStore.Save(value)
	if err != nil {
		slog.Error("save config failed", slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "limit must be a positive integer"})
			return
		}
		limit = min(parsed, 200)
	}

	result, err := s.client.State(ctx, repoOptionsFromQuery(r), limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleCommit(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	result, err := s.client.Commit(ctx, repoOptionsFromQuery(r), r.URL.Query().Get("rev"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleBookmarks(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	result, err := s.client.Bookmarks(ctx, repoOptionsFromQuery(r))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleRemotes(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	result, err := s.client.Remotes(ctx, repoOptionsFromQuery(r))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleWorkspaces(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	result, err := s.client.Workspaces(ctx, repoOptionsFromQuery(r))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleOperations(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "limit must be a positive integer"})
			return
		}
		limit = min(parsed, 500)
	}

	result, err := s.client.OperationLog(ctx, repoOptionsFromQuery(r), limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleRestoreOperation(w http.ResponseWriter, r *http.Request) {
	operationID, err := operationIDFromRestorePath(r.URL.Path)
	if err != nil {
		writeRequestError(w, err)
		return
	}

	var req repoPathRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	result, err := s.client.RestoreOperation(ctx, repo.RequestOptions{RepoPath: req.RepoPath}, operationID)
	if err != nil {
		slog.ErrorContext(ctx, "restore operation failed", slog.String("repo_path", req.RepoPath), slog.String("operation_id", operationID), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "operation restored", slog.String("repo_path", result.RepoPath), slog.String("operation_id", operationID))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleUndoLastOperation(w http.ResponseWriter, r *http.Request) {
	var req repoPathRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	result, err := s.client.UndoLastOperation(ctx, repo.RequestOptions{RepoPath: req.RepoPath})
	if err != nil {
		slog.ErrorContext(ctx, "undo failed", slog.String("repo_path", req.RepoPath), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "operation undone", slog.String("repo_path", result.RepoPath))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleDiff(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	ignoreWhitespace := r.URL.Query().Get("ignoreWhitespace") == "true"
	result, err := s.client.Diff(ctx, repoOptionsFromQuery(r), r.URL.Query().Get("rev"), ignoreWhitespace)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleFileContent(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	path := r.URL.Query().Get("path")
	if strings.TrimSpace(path) == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "path is required"})
		return
	}

	result, err := s.client.FileContent(ctx, repoOptionsFromQuery(r), r.URL.Query().Get("rev"), path)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleEvolutionLog(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	limit := 30
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "limit must be a positive integer"})
			return
		}
		limit = min(parsed, 100)
	}

	result, err := s.client.EvolutionLog(ctx, repoOptionsFromQuery(r), r.URL.Query().Get("rev"), limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleEvolutionDiff(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	result, err := s.client.EvolutionDiff(ctx, repoOptionsFromQuery(r), r.URL.Query().Get("rev"), r.URL.Query().Get("commitId"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleCheckout(w http.ResponseWriter, r *http.Request) {
	var req revisionRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	result, err := s.client.Checkout(ctx, repo.RequestOptions{RepoPath: req.RepoPath}, req.Rev)
	if err != nil {
		slog.ErrorContext(ctx, "checkout failed", slog.String("repo_path", req.RepoPath), slog.String("rev", req.Rev), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "checked out revision", slog.String("repo_path", result.RepoPath), slog.String("rev", req.Rev))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleNewFrom(w http.ResponseWriter, r *http.Request) {
	var req revisionRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	result, err := s.client.NewFrom(ctx, repo.RequestOptions{RepoPath: req.RepoPath}, req.Rev)
	if err != nil {
		slog.ErrorContext(ctx, "new change failed", slog.String("repo_path", req.RepoPath), slog.String("rev", req.Rev), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "created new change", slog.String("repo_path", result.RepoPath), slog.String("parent_rev", req.Rev))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleDescribe(w http.ResponseWriter, r *http.Request) {
	var req describeRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	result, err := s.client.Describe(ctx, repo.RequestOptions{RepoPath: req.RepoPath}, req.Rev, req.DescribeRequest)
	if err != nil {
		slog.ErrorContext(ctx, "describe failed", slog.String("repo_path", req.RepoPath), slog.String("rev", req.Rev), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "change described", slog.String("repo_path", result.RepoPath), slog.String("rev", req.Rev), slog.String("title", req.Title))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAbandon(w http.ResponseWriter, r *http.Request) {
	var req revisionRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	result, err := s.client.Abandon(ctx, repo.RequestOptions{RepoPath: req.RepoPath}, req.Rev)
	if err != nil {
		slog.ErrorContext(ctx, "abandon failed", slog.String("repo_path", req.RepoPath), slog.String("rev", req.Rev), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "abandoned change", slog.String("repo_path", result.RepoPath), slog.String("rev", req.Rev))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleRebase(w http.ResponseWriter, r *http.Request) {
	var req revisionRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	result, err := s.client.Rebase(ctx, repo.RequestOptions{RepoPath: req.RepoPath}, req.Rev)
	if err != nil {
		slog.ErrorContext(ctx, "rebase failed", slog.String("repo_path", req.RepoPath), slog.String("rev", req.Rev), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "rebased change", slog.String("repo_path", result.RepoPath), slog.String("rev", req.Rev))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleRestorePaths(w http.ResponseWriter, r *http.Request) {
	var req restorePathsRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	result, err := s.client.RestorePaths(ctx, repo.RequestOptions{RepoPath: req.RepoPath}, req.Rev, req.Paths)
	if err != nil {
		slog.ErrorContext(ctx, "restore paths failed", slog.String("repo_path", req.RepoPath), slog.String("rev", req.Rev), slog.Any("paths", req.Paths), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "restored paths", slog.String("repo_path", result.RepoPath), slog.String("rev", req.Rev), slog.Any("paths", req.Paths))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleRestoreHunk(w http.ResponseWriter, r *http.Request) {
	var req restoreHunkRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	result, err := s.client.RestoreHunk(ctx, repo.RequestOptions{RepoPath: req.RepoPath}, req.Rev, req.HunkRestoreRequest)
	if err != nil {
		slog.ErrorContext(ctx, "restore hunk failed", slog.String("repo_path", req.RepoPath), slog.String("rev", req.Rev), slog.String("path", req.Path), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "restored hunk", slog.String("repo_path", result.RepoPath), slog.String("rev", req.Rev), slog.String("path", req.Path), slog.Int("new_start", req.NewStart))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleFetch(w http.ResponseWriter, r *http.Request) {
	var req repoPathRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	result, err := s.client.Fetch(ctx, repo.RequestOptions{RepoPath: req.RepoPath})
	if err != nil {
		slog.ErrorContext(ctx, "fetch failed", slog.String("repo_path", req.RepoPath), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "fetched from remote", slog.String("repo_path", result.RepoPath))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSetBookmark(w http.ResponseWriter, r *http.Request) {
	var req repo.BookmarkRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	if r.Method == http.MethodPut {
		name, err := bookmarkNameFromPath(r.URL.Path)
		if err != nil {
			writeRequestError(w, err)
			return
		}
		req.Name = name
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	result, err := s.client.SetBookmark(ctx, repo.RequestOptions{RepoPath: req.RepoPath}, req)
	if err != nil {
		slog.ErrorContext(ctx, "set bookmark failed", slog.String("repo_path", req.RepoPath), slog.String("bookmark", req.Name), slog.String("rev", req.Rev), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "bookmark set", slog.String("repo_path", result.RepoPath), slog.String("bookmark", req.Name), slog.String("rev", req.Rev))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleDeleteBookmark(w http.ResponseWriter, r *http.Request) {
	name, err := bookmarkNameFromPath(r.URL.Path)
	if err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	result, err := s.client.DeleteBookmark(ctx, repoOptionsFromQuery(r), name)
	if err != nil {
		slog.ErrorContext(ctx, "delete bookmark failed", slog.String("repo_path", r.URL.Query().Get("repoPath")), slog.String("bookmark", name), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "bookmark deleted", slog.String("repo_path", result.RepoPath), slog.String("bookmark", name))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handlePushBookmark(w http.ResponseWriter, r *http.Request) {
	name, err := bookmarkNameFromPushPath(r.URL.Path)
	if err != nil {
		writeRequestError(w, err)
		return
	}

	var req pushBookmarkRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	result, err := s.client.PushBookmark(ctx, repo.RequestOptions{RepoPath: req.RepoPath}, repo.PushBookmarkRequest{
		Name:     name,
		Remote:   req.Remote,
		AllowNew: req.AllowNew,
	})
	if err != nil {
		slog.ErrorContext(ctx, "push bookmark failed", slog.String("repo_path", req.RepoPath), slog.String("bookmark", name), slog.String("remote", req.Remote), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "bookmark pushed", slog.String("repo_path", result.RepoPath), slog.String("bookmark", name), slog.String("remote", req.Remote))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAddWorkspace(w http.ResponseWriter, r *http.Request) {
	var req repo.WorkspaceRequest
	if err := decodeRequest(r, &req); err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	result, err := s.client.AddWorkspace(ctx, repo.RequestOptions{RepoPath: req.RepoPath}, req)
	if err != nil {
		slog.ErrorContext(ctx, "add workspace failed", slog.String("repo_path", req.RepoPath), slog.String("workspace", req.Name), slog.String("destination", req.Destination), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "workspace added", slog.String("repo_path", result.RepoPath), slog.String("workspace", req.Name), slog.String("destination", req.Destination), slog.String("rev", req.Rev))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleForgetWorkspace(w http.ResponseWriter, r *http.Request) {
	name, err := workspaceNameFromPath(r.URL.Path)
	if err != nil {
		writeRequestError(w, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	result, err := s.client.ForgetWorkspace(ctx, repoOptionsFromQuery(r), name)
	if err != nil {
		slog.ErrorContext(ctx, "forget workspace failed", slog.String("repo_path", r.URL.Query().Get("repoPath")), slog.String("workspace", name), slog.Any("error", err))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		return
	}

	slog.InfoContext(ctx, "workspace forgotten", slog.String("repo_path", result.RepoPath), slog.String("workspace", name))
	writeJSON(w, http.StatusOK, result)
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func decodeRequest(r *http.Request, value any) error {
	defer r.Body.Close()
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return &requestError{
			status:  http.StatusUnsupportedMediaType,
			code:    "unsupported_media_type",
			message: "Content-Type must be application/json",
		}
	}

	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxRequestBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			return &requestError{
				status:  http.StatusRequestEntityTooLarge,
				code:    "request_too_large",
				message: "Request body must not exceed 1 MiB",
			}
		}
		return &requestError{
			status:  http.StatusBadRequest,
			code:    "invalid_json",
			message: "Request body must be valid JSON with no unknown fields",
		}
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return &requestError{
			status:  http.StatusBadRequest,
			code:    "invalid_json",
			message: "Request body must contain exactly one JSON value",
		}
	}
	return nil
}

type requestError struct {
	status  int
	code    string
	message string
}

func (e *requestError) Error() string {
	return e.message
}

func writeRequestError(w http.ResponseWriter, err error) {
	var requestErr *requestError
	if errors.As(err, &requestErr) {
		writeJSON(w, requestErr.status, errorResponse{Error: requestErr.message, Code: requestErr.code})
		return
	}
	writeJSON(w, http.StatusBadRequest, errorResponse{Error: err.Error(), Code: "invalid_request"})
}

func repoOptionsFromQuery(r *http.Request) repo.RequestOptions {
	return repo.RequestOptions{
		RepoPath: r.URL.Query().Get("repoPath"),
		Revset:   r.URL.Query().Get("revset"),
		CommitID: r.URL.Query().Get("commitId"),
	}
}

func bookmarkNameFromPath(path string) (string, error) {
	raw := strings.TrimPrefix(path, "/api/bookmarks/")
	if raw == "" {
		return "", fmt.Errorf("bookmark name is required")
	}

	name, err := url.PathUnescape(raw)
	if err != nil {
		return "", fmt.Errorf("decode bookmark name: %w", err)
	}
	return name, nil
}

func bookmarkNameFromPushPath(path string) (string, error) {
	raw, ok := strings.CutSuffix(strings.TrimPrefix(path, "/api/bookmarks/"), "/push")
	if !ok || raw == "" {
		return "", fmt.Errorf("bookmark name is required")
	}

	name, err := url.PathUnescape(raw)
	if err != nil {
		return "", fmt.Errorf("decode bookmark name: %w", err)
	}
	return name, nil
}

func workspaceNameFromPath(path string) (string, error) {
	raw := strings.TrimPrefix(path, "/api/workspaces/")
	if raw == "" {
		return "", fmt.Errorf("workspace name is required")
	}

	name, err := url.PathUnescape(raw)
	if err != nil {
		return "", fmt.Errorf("decode workspace name: %w", err)
	}
	return name, nil
}

func operationIDFromRestorePath(path string) (string, error) {
	raw, ok := strings.CutSuffix(strings.TrimPrefix(path, "/api/operations/"), "/restore")
	if !ok || raw == "" {
		return "", fmt.Errorf("operation id is required")
	}

	id, err := url.PathUnescape(raw)
	if err != nil {
		return "", fmt.Errorf("decode operation id: %w", err)
	}
	return id, nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	if failure, ok := value.(errorResponse); ok {
		if failure.Code == "" {
			failure.Code = errorCodeForStatus(status)
		}
		if status >= http.StatusInternalServerError {
			slog.Error("request failed", "status", status, "error", failure.Error)
			failure.Error = "internal server error"
		}
		value = failure
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

type errorResponse struct {
	Error string `json:"-"`
	Code  string `json:"-"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (r errorResponse) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Error apiError `json:"error"`
	}{Error: apiError{Code: r.Code, Message: r.Error}})
}

func (r *errorResponse) UnmarshalJSON(data []byte) error {
	var payload struct {
		Error apiError `json:"error"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	r.Code = payload.Error.Code
	r.Error = payload.Error.Message
	return nil
}

func errorCodeForStatus(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "invalid_request"
	case http.StatusUnauthorized:
		return "unauthorized"
	case http.StatusForbidden:
		return "forbidden"
	case http.StatusNotFound:
		return "not_found"
	case http.StatusConflict:
		return "conflict"
	case http.StatusRequestEntityTooLarge:
		return "request_too_large"
	case http.StatusUnsupportedMediaType:
		return "unsupported_media_type"
	case http.StatusServiceUnavailable:
		return "service_unavailable"
	default:
		if status >= http.StatusInternalServerError {
			return "internal_error"
		}
		return "request_failed"
	}
}

type revisionRequest struct {
	Rev      string `json:"rev"`
	RepoPath string `json:"repoPath,omitempty"`
}

type repoPathRequest struct {
	RepoPath string `json:"repoPath,omitempty"`
}

type pushBookmarkRequest struct {
	RepoPath string `json:"repoPath,omitempty"`
	Remote   string `json:"remote,omitempty"`
	AllowNew bool   `json:"allowNew,omitempty"`
}

type restorePathsRequest struct {
	Rev      string   `json:"rev"`
	RepoPath string   `json:"repoPath,omitempty"`
	Paths    []string `json:"paths"`
}

type restoreHunkRequest struct {
	Rev      string `json:"rev"`
	RepoPath string `json:"repoPath,omitempty"`
	repo.HunkRestoreRequest
}

type describeRequest struct {
	Rev      string `json:"rev"`
	RepoPath string `json:"repoPath,omitempty"`
	repo.DescribeRequest
}
