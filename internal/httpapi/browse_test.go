package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestHandleBrowseDirs(t *testing.T) {
	root := t.TempDir()
	for _, dir := range []string{"beta", "alpha/.jj", ".hidden"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/browse/dirs?path="+url.QueryEscape(root), nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &fakeClient{}).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body %s)", rec.Code, http.StatusOK, rec.Body.String())
	}

	var got browseDirsResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Path != root {
		t.Fatalf("path = %q, want %q", got.Path, root)
	}
	if got.Parent != filepath.Dir(root) {
		t.Fatalf("parent = %q, want %q", got.Parent, filepath.Dir(root))
	}
	if got.IsRepo {
		t.Fatal("root should not be a repo")
	}
	if len(got.Dirs) != 2 {
		t.Fatalf("dirs = %d, want 2 (%+v)", len(got.Dirs), got.Dirs)
	}
	if got.Dirs[0].Name != "alpha" || !got.Dirs[0].IsRepo {
		t.Fatalf("dirs[0] = %+v, want alpha with isRepo=true", got.Dirs[0])
	}
	if got.Dirs[1].Name != "beta" || got.Dirs[1].IsRepo {
		t.Fatalf("dirs[1] = %+v, want beta with isRepo=false", got.Dirs[1])
	}
}

func TestHandleBrowseDirsRejectsMissingDir(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "does-not-exist")
	req := httptest.NewRequest(http.MethodGet, "/api/browse/dirs?path="+url.QueryEscape(missing), nil)
	rec := httptest.NewRecorder()

	newTestServer(t, &fakeClient{}).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
