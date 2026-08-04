package restoretool

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunWritesPreparedContentInsideRightSide(t *testing.T) {
	dir := t.TempDir()
	right := filepath.Join(dir, "right")
	if err := os.Mkdir(right, 0o755); err != nil {
		t.Fatal(err)
	}
	contentPath := filepath.Join(dir, "content")
	if err := os.WriteFile(contentPath, []byte("restored\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, setting := range Environment("src/main.go", contentPath) {
		name, value, _ := strings.Cut(setting, "=")
		t.Setenv(name, value)
	}

	handled, err := Run([]string{Command, right})
	if err != nil {
		t.Fatal(err)
	}
	if !handled {
		t.Fatal("restore tool invocation was not handled")
	}
	got, err := os.ReadFile(filepath.Join(right, "src", "main.go"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "restored\n" {
		t.Fatalf("restored content = %q, want %q", got, "restored\\n")
	}
}

func TestRunRejectsPathOutsideRightSide(t *testing.T) {
	dir := t.TempDir()
	contentPath := filepath.Join(dir, "content")
	if err := os.WriteFile(contentPath, []byte("restored\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, setting := range Environment("../outside", contentPath) {
		name, value, _ := strings.Cut(setting, "=")
		t.Setenv(name, value)
	}

	handled, err := Run([]string{Command, dir})
	if !handled || err == nil {
		t.Fatalf("Run() = %t, %v; want handled error", handled, err)
	}
}

func TestRunIgnoresNormalServerArguments(t *testing.T) {
	handled, err := Run([]string{"-addr", "127.0.0.1:7000"})
	if handled || err != nil {
		t.Fatalf("Run() = %t, %v; want false, nil", handled, err)
	}
}
