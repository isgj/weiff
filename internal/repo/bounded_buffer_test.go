package repo

import "testing"

func TestBoundedBufferRetainsPrefixAndConsumesAllInput(t *testing.T) {
	var buffer boundedBuffer
	buffer.limit = 5

	written, err := buffer.Write([]byte("abc"))
	if err != nil || written != 3 {
		t.Fatalf("first Write() = %d, %v; want 3, nil", written, err)
	}
	written, err = buffer.Write([]byte("defg"))
	if err != nil || written != 4 {
		t.Fatalf("second Write() = %d, %v; want 4, nil", written, err)
	}
	if got := string(buffer.Bytes()); got != "abcde" {
		t.Fatalf("buffer = %q, want %q", got, "abcde")
	}
	if !buffer.Truncated() {
		t.Fatal("buffer was not marked truncated")
	}
}

func TestUnboundedBufferRetainsAllInput(t *testing.T) {
	var buffer boundedBuffer
	if _, err := buffer.Write([]byte("abcdef")); err != nil {
		t.Fatal(err)
	}
	if got := string(buffer.Bytes()); got != "abcdef" {
		t.Fatalf("buffer = %q, want %q", got, "abcdef")
	}
	if buffer.Truncated() {
		t.Fatal("unbounded buffer was marked truncated")
	}
}
