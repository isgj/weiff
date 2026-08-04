package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"weiff/internal/repo"
)

func (s *Server) handleRepositoryFiles(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	result, err := s.client.RepositoryFiles(
		ctx,
		repoOptionsFromQuery(r),
		r.URL.Query().Get("rev"),
		r.URL.Query().Get("path"),
	)
	if err != nil {
		switch {
		case errors.Is(err, repo.ErrInvalidRepositoryFilePath):
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: err.Error(), Code: "invalid_path"})
		case errors.Is(err, repo.ErrRepositoryFileNotFound):
			writeJSON(w, http.StatusNotFound, errorResponse{Error: err.Error(), Code: "path_not_found"})
		case errors.Is(err, repo.ErrRepositoryListingTooLarge):
			writeJSON(w, http.StatusRequestEntityTooLarge, errorResponse{Error: err.Error(), Code: "listing_too_large"})
		default:
			writeJSON(w, http.StatusInternalServerError, errorResponse{Error: err.Error()})
		}
		return
	}

	writeJSON(w, http.StatusOK, result)
}
