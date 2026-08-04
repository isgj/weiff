package repo

import (
	"strings"
)

func ParseGitDiff(raw string, summary []DiffFile) []DiffFile {
	summaryByPath := make(map[string]DiffFile, len(summary))
	for _, file := range summary {
		summaryByPath[file.Path] = file
	}

	var files []DiffFile
	var current *DiffFile

	for line := range strings.Lines(raw) {
		line = strings.TrimSuffix(line, "\n")

		if strings.HasPrefix(line, "diff --git ") {
			if current != nil {
				files = append(files, *current)
			}

			path := pathFromDiffHeader(line)
			file := DiffFile{Path: path, Lines: []DiffLine{{Kind: "header", Content: line}}}
			if summary, ok := summaryByPath[path]; ok {
				file.Status = summary.Status
				file.StatusChar = summary.StatusChar
				file.Conflict = summary.Conflict
			}
			current = &file
			continue
		}

		if current == nil {
			continue
		}

		current.Lines = append(current.Lines, DiffLine{
			Kind:    diffLineKind(line),
			Content: line,
		})
	}

	if current != nil {
		files = append(files, *current)
	}

	if len(files) == 0 && len(summary) > 0 {
		for i := range summary {
			summary[i].Lines = nonNilSlice(summary[i].Lines)
		}
		return summary
	}

	for i := range files {
		files[i].Lines = nonNilSlice(files[i].Lines)
	}
	return nonNilSlice(files)
}

func pathFromDiffHeader(line string) string {
	rest := strings.TrimPrefix(line, "diff --git ")
	if rest == line {
		return ""
	}

	// Prefer the new path ("b/..."), falling back to the old one. Paths may
	// contain spaces, so locate the "b/" separator instead of splitting on
	// whitespace. Quoted paths (`diff --git "a/x y" "b/x y"`) are handled too.
	for _, sep := range []string{` "b/`, " b/"} {
		if idx := strings.LastIndex(rest, sep); idx >= 0 {
			path := strings.TrimSuffix(rest[idx+len(sep):], `"`)
			if path != "" && path != "/dev/null" {
				return path
			}
		}
	}
	if strings.HasPrefix(rest, `"a/`) {
		trimmed := rest[len(`"a/`):]
		if end := strings.Index(trimmed, `"`); end >= 0 {
			return trimmed[:end]
		}
	}
	if strings.HasPrefix(rest, "a/") {
		trimmed := rest[len("a/"):]
		if end := strings.Index(trimmed, " "); end >= 0 {
			return trimmed[:end]
		}
	}
	return ""
}

func diffLineKind(line string) string {
	switch {
	case strings.HasPrefix(line, "@@"):
		return "hunk"
	case strings.HasPrefix(line, "+++") || strings.HasPrefix(line, "---"):
		return "file"
	case strings.HasPrefix(line, "+"):
		return "added"
	case strings.HasPrefix(line, "-"):
		return "removed"
	case strings.HasPrefix(line, "index ") || strings.HasPrefix(line, "new file mode ") || strings.HasPrefix(line, "deleted file mode "):
		return "meta"
	default:
		return "context"
	}
}
