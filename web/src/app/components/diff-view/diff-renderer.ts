import { diffWordsWithSpace, parsePatch, type StructuredPatch } from 'diff';
import { DiffFile, DiffLine, DiffResult, HunkRestoreRequest } from '../../data/repo-api';
import {
  escapeCodeHtml,
  highlightCode,
  isSyntaxLanguageSupported,
  languageForPath,
} from '../../shared/syntax-highlighter';

export type RenderedDiffLineKind = 'added' | 'removed' | 'context' | 'note';
export type SplitDiffRowKind = RenderedDiffLineKind | 'changed';

export interface RenderedDiffFile extends DiffFile {
  hunks: RenderedDiffHunk[];
  splitRows: SplitDiffRow[];
  addedCount: number;
  removedCount: number;
  language: string | null;
  statusIcon: string;
  statusLabel: string;
  trailingGap: ContextGap | null;
}

export interface RenderedDiffHunk {
  header: string;
  lines: RenderedDiffLine[];
  splitRows: SplitDiffRow[];
  restore: Omit<HunkRestoreRequest, 'path'> | null;
  gapBefore: ContextGap | null;
}

export interface ContextGap {
  key: string;
  path: string;
  /** First hidden line in the new file (1-based). */
  newStart: number;
  /** Last hidden line in the new file, or null to expand to end of file. */
  newEnd: number | null;
  /** oldLineNumber = newLineNumber + lineDelta within this gap. */
  lineDelta: number;
}

export interface ExpandedGap {
  lines: RenderedDiffLine[];
  splitRows: SplitDiffRow[];
}

export interface RenderedDiffLine {
  kind: RenderedDiffLineKind;
  content: string;
  highlightedContent: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  symbol: string;
}

export interface SplitDiffRow {
  kind: SplitDiffRowKind;
  left: SplitDiffCell | null;
  right: SplitDiffCell | null;
  full: RenderedDiffLine | null;
}

export interface SplitDiffCell {
  lineNumber: number | null;
  highlightedContent: string;
}

// Word-level diffing is skipped for very long lines (cost) and for pairs where
// nearly the whole line changed (noise).
const maxWordDiffLineLength = 1000;
const maxWordDiffChangedRatio = 0.7;

export class DiffRenderer {
  buildFiles(diff: DiffResult | null): RenderedDiffFile[] {
    if (diff == null) {
      return [];
    }

    const backendFiles = diff.files ?? [];
    const backendByPath = new Map(
      backendFiles.map((file) => [this.normalizePath(file.path), file] as const),
    );

    const rawPatchFiles = this.parseRawPatch(diff.diff);
    if (rawPatchFiles.length > 0) {
      return rawPatchFiles.map((patch) => this.renderPatchFile(patch, backendByPath));
    }

    return backendFiles.map((file) => this.renderBackendFile(file));
  }

  private parseRawPatch(rawDiff: string): StructuredPatch[] {
    const trimmed = rawDiff.trim();
    if (trimmed === '') {
      return [];
    }

    try {
      return parsePatch(trimmed).filter(
        (patch) =>
          patch.hunks.length > 0 ||
          patch.isBinary ||
          patch.isRename ||
          patch.isCopy ||
          patch.isCreate ||
          patch.isDelete ||
          patch.oldMode != null ||
          patch.newMode != null,
      );
    } catch {
      return [];
    }
  }

  private renderPatchFile(
    patch: StructuredPatch,
    backendByPath: ReadonlyMap<string, DiffFile>,
  ): RenderedDiffFile {
    const path = this.patchPath(patch);
    const normalizedPath = this.normalizePath(path);
    const backendFile = backendByPath.get(normalizedPath);
    const language = languageForPath(path);
    const expandable = !patch.isDelete && !(patch.isCreate ?? false);
    let previousNewEnd = 0;
    let previousOldEnd = 0;
    const hunks = patch.hunks.map((hunk) => {
      const lines = this.renderHunkLines(hunk.lines, hunk.oldStart, hunk.newStart, language);
      let gapBefore: ContextGap | null = null;
      if (expandable && hunk.newStart > previousNewEnd + 1) {
        gapBefore = {
          key: `${path}:${previousNewEnd + 1}`,
          path,
          newStart: previousNewEnd + 1,
          newEnd: hunk.newStart - 1,
          lineDelta: previousOldEnd - previousNewEnd,
        };
      }
      previousNewEnd = hunk.newStart + hunk.newLines - 1;
      previousOldEnd = hunk.oldStart + hunk.oldLines - 1;

      return {
        header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        lines,
        splitRows: this.buildSplitRows(lines),
        restore: { newStart: hunk.newStart, lines: [...hunk.lines] },
        gapBefore,
      };
    });
    const trailingGap: ContextGap | null =
      expandable && hunks.length > 0
        ? {
            key: `${path}:${previousNewEnd + 1}:end`,
            path,
            newStart: previousNewEnd + 1,
            newEnd: null,
            lineDelta: previousOldEnd - previousNewEnd,
          }
        : null;
    const addedCount = hunks
      .flatMap((hunk) => hunk.lines)
      .filter((line) => line.kind === 'added').length;
    const removedCount = hunks
      .flatMap((hunk) => hunk.lines)
      .filter((line) => line.kind === 'removed').length;
    const statusChar = backendFile?.statusChar || this.statusCharForPatch(patch);
    const status = backendFile?.status || this.statusForPatch(patch);

    return {
      path,
      status,
      statusChar,
      conflict: backendFile?.conflict ?? false,
      lines: [],
      hunks,
      splitRows: hunks.flatMap((hunk) => hunk.splitRows),
      addedCount,
      removedCount,
      language,
      statusIcon: this.statusIcon(statusChar),
      statusLabel: this.statusLabel(statusChar, status),
      trailingGap,
    };
  }

  private renderBackendFile(file: DiffFile): RenderedDiffFile {
    const language = languageForPath(file.path);
    const hunks = this.renderBackendHunks(file.lines ?? [], language);
    const addedCount = hunks
      .flatMap((hunk) => hunk.lines)
      .filter((line) => line.kind === 'added').length;
    const removedCount = hunks
      .flatMap((hunk) => hunk.lines)
      .filter((line) => line.kind === 'removed').length;

    return {
      ...file,
      hunks,
      splitRows: hunks.flatMap((hunk) => hunk.splitRows),
      addedCount,
      removedCount,
      language,
      statusIcon: this.statusIcon(file.statusChar),
      statusLabel: this.statusLabel(file.statusChar, file.status),
      trailingGap: null,
    };
  }

  private renderBackendHunks(lines: DiffLine[], language: string | null): RenderedDiffHunk[] {
    const hunks: RenderedDiffHunk[] = [];
    let currentLines: RenderedDiffLine[] = [];
    let currentHeader = 'Changes';
    let oldLineNumber = 1;
    let newLineNumber = 1;

    const pushCurrent = () => {
      if (currentLines.length === 0) {
        return;
      }

      hunks.push({
        header: currentHeader,
        lines: currentLines,
        splitRows: this.buildSplitRows(currentLines),
        restore: null,
        gapBefore: null,
      });
      currentLines = [];
    };

    for (const line of lines) {
      if (line.kind === 'hunk') {
        pushCurrent();
        currentHeader = line.content;
        const parsedHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line.content);
        oldLineNumber = parsedHeader == null ? oldLineNumber : Number(parsedHeader[1]);
        newLineNumber = parsedHeader == null ? newLineNumber : Number(parsedHeader[2]);
        continue;
      }

      if (line.kind !== 'added' && line.kind !== 'removed' && line.kind !== 'context') {
        continue;
      }

      const renderedLine = this.renderLine(
        line.kind,
        this.stripDiffMarker(line.content),
        line.kind === 'added' ? null : oldLineNumber,
        line.kind === 'removed' ? null : newLineNumber,
        language,
      );
      currentLines.push(renderedLine);

      if (line.kind !== 'added') {
        oldLineNumber++;
      }
      if (line.kind !== 'removed') {
        newLineNumber++;
      }
    }

    pushCurrent();
    return hunks;
  }

  private renderHunkLines(
    lines: string[],
    initialOldLineNumber: number,
    initialNewLineNumber: number,
    language: string | null,
  ): RenderedDiffLine[] {
    const renderedLines: RenderedDiffLine[] = [];
    let oldLineNumber = initialOldLineNumber;
    let newLineNumber = initialNewLineNumber;

    for (const line of lines) {
      const prefix = line.charAt(0);
      switch (prefix) {
        case '+':
          renderedLines.push(
            this.renderLine('added', line.slice(1), null, newLineNumber, language),
          );
          newLineNumber++;
          break;
        case '-':
          renderedLines.push(
            this.renderLine('removed', line.slice(1), oldLineNumber, null, language),
          );
          oldLineNumber++;
          break;
        case ' ':
          renderedLines.push(
            this.renderLine('context', line.slice(1), oldLineNumber, newLineNumber, language),
          );
          oldLineNumber++;
          newLineNumber++;
          break;
        case '\\':
          renderedLines.push(this.renderLine('note', line, null, null, null));
          break;
      }
    }

    this.rehighlightAsBlocks(renderedLines, language);
    return renderedLines;
  }

  /**
   * Re-runs syntax highlighting over each hunk side as one block so multi-line
   * constructs (block comments, template strings) keep their state, then
   * splits the highlighted HTML back into lines.
   */
  private rehighlightAsBlocks(lines: RenderedDiffLine[], language: string | null): void {
    if (!isSyntaxLanguageSupported(language)) {
      return;
    }

    const oldSide = lines.filter((line) => line.kind === 'removed' || line.kind === 'context');
    const newSide = lines.filter((line) => line.kind === 'added' || line.kind === 'context');

    for (const side of [oldSide, newSide]) {
      if (side.length === 0) {
        continue;
      }
      const block = side.map((line) => line.content).join('\n');
      const highlighted = highlightCode(block, language);
      const htmlLines = splitHighlightedHtml(highlighted, side.length);
      for (const [index, line] of side.entries()) {
        line.highlightedContent = htmlLines[index] === '' ? '&nbsp;' : htmlLines[index];
      }
    }
  }

  renderLine(
    kind: RenderedDiffLineKind,
    content: string,
    oldLineNumber: number | null,
    newLineNumber: number | null,
    language: string | null,
  ): RenderedDiffLine {
    return {
      kind,
      content,
      highlightedContent:
        kind === 'note' ? escapeCodeHtml(content) : highlightCode(content, language),
      oldLineNumber,
      newLineNumber,
      symbol: this.lineSymbol(kind),
    };
  }

  buildSplitRows(lines: RenderedDiffLine[]): SplitDiffRow[] {
    this.applyWordHighlights(lines);

    const rows: SplitDiffRow[] = [];
    let pendingRemoved: RenderedDiffLine[] = [];
    let pendingAdded: RenderedDiffLine[] = [];

    const flushChangedRows = () => {
      const rowCount = Math.max(pendingRemoved.length, pendingAdded.length);
      for (let index = 0; index < rowCount; index++) {
        rows.push({
          kind:
            pendingRemoved[index] != null && pendingAdded[index] != null
              ? 'changed'
              : (pendingRemoved[index]?.kind ?? pendingAdded[index]?.kind ?? 'context'),
          left: this.splitCell(pendingRemoved[index] ?? null),
          right: this.splitCell(pendingAdded[index] ?? null),
          full: null,
        });
      }

      pendingRemoved = [];
      pendingAdded = [];
    };

    for (const line of lines) {
      if (line.kind === 'removed') {
        pendingRemoved.push(line);
        continue;
      }

      if (line.kind === 'added') {
        pendingAdded.push(line);
        continue;
      }

      flushChangedRows();
      if (line.kind === 'context') {
        rows.push({
          kind: line.kind,
          left: this.splitCell(line),
          right: this.splitCell(line),
          full: null,
        });
      } else {
        rows.push({ kind: line.kind, left: null, right: null, full: line });
      }
    }

    flushChangedRows();
    return rows;
  }

  private applyWordHighlights(lines: RenderedDiffLine[]): void {
    let pendingRemoved: RenderedDiffLine[] = [];
    let pendingAdded: RenderedDiffLine[] = [];

    const flushPairs = () => {
      const pairCount = Math.min(pendingRemoved.length, pendingAdded.length);
      for (let index = 0; index < pairCount; index++) {
        this.highlightWordChanges(pendingRemoved[index], pendingAdded[index]);
      }
      pendingRemoved = [];
      pendingAdded = [];
    };

    for (const line of lines) {
      if (line.kind === 'removed') {
        pendingRemoved.push(line);
        continue;
      }
      if (line.kind === 'added') {
        pendingAdded.push(line);
        continue;
      }
      flushPairs();
    }
    flushPairs();
  }

  private highlightWordChanges(removed: RenderedDiffLine, added: RenderedDiffLine): void {
    if (
      removed.content === added.content ||
      removed.content.length > maxWordDiffLineLength ||
      added.content.length > maxWordDiffLineLength
    ) {
      return;
    }

    const removedRanges: [number, number][] = [];
    const addedRanges: [number, number][] = [];
    let oldOffset = 0;
    let newOffset = 0;
    let removedChars = 0;
    let addedChars = 0;
    for (const part of diffWordsWithSpace(removed.content, added.content)) {
      const length = part.value.length;
      if (part.removed) {
        removedRanges.push([oldOffset, oldOffset + length]);
        removedChars += length;
        oldOffset += length;
      } else if (part.added) {
        addedRanges.push([newOffset, newOffset + length]);
        addedChars += length;
        newOffset += length;
      } else {
        oldOffset += length;
        newOffset += length;
      }
    }

    if (
      removedChars > removed.content.length * maxWordDiffChangedRatio &&
      addedChars > added.content.length * maxWordDiffChangedRatio
    ) {
      return;
    }

    if (removedRanges.length > 0) {
      removed.highlightedContent = this.overlayRanges(
        removed.highlightedContent,
        removedRanges,
        'diff-word-removed',
      );
    }
    if (addedRanges.length > 0) {
      added.highlightedContent = this.overlayRanges(
        added.highlightedContent,
        addedRanges,
        'diff-word-added',
      );
    }
  }

  /**
   * Wraps the given plain-text character ranges of an HTML fragment in marker
   * spans, leaving existing tags intact. Tags count as zero characters and
   * entities count as one, matching offsets in the original plain text.
   */
  private overlayRanges(html: string, ranges: [number, number][], className: string): string {
    let result = '';
    let textOffset = 0;
    let rangeIndex = 0;
    let open = false;
    let i = 0;

    while (i < html.length) {
      if (html[i] === '<') {
        if (open) {
          result += '</span>';
          open = false;
        }
        const tagEnd = html.indexOf('>', i);
        const next = tagEnd === -1 ? html.length : tagEnd + 1;
        result += html.slice(i, next);
        i = next;
        continue;
      }

      while (rangeIndex < ranges.length && textOffset >= ranges[rangeIndex][1]) {
        rangeIndex++;
      }
      const inRange = rangeIndex < ranges.length && textOffset >= ranges[rangeIndex][0];
      if (inRange && !open) {
        result += `<span class="${className}">`;
        open = true;
      } else if (!inRange && open) {
        result += '</span>';
        open = false;
      }

      if (html[i] === '&') {
        const semicolon = html.indexOf(';', i);
        const next = semicolon !== -1 && semicolon - i <= 10 ? semicolon + 1 : i + 1;
        result += html.slice(i, next);
        i = next;
      } else {
        result += html[i];
        i++;
      }
      textOffset++;
    }

    if (open) {
      result += '</span>';
    }
    return result;
  }

  private splitCell(line: RenderedDiffLine | null): SplitDiffCell | null {
    if (line == null) {
      return null;
    }

    return {
      lineNumber: line.kind === 'added' ? line.newLineNumber : line.oldLineNumber,
      highlightedContent: line.highlightedContent,
    };
  }

  private patchPath(patch: StructuredPatch): string {
    const path =
      patch.newFileName == null || patch.newFileName === '/dev/null'
        ? patch.oldFileName
        : patch.newFileName;

    return this.normalizePath(path ?? 'unknown');
  }

  private normalizePath(path: string): string {
    return path.replace(/^([ab])\//, '');
  }

  private statusCharForPatch(patch: StructuredPatch): string {
    if (patch.isCreate) {
      return 'A';
    }
    if (patch.isDelete) {
      return 'D';
    }
    if (patch.isRename) {
      return 'R';
    }
    if (patch.isCopy) {
      return 'C';
    }
    return 'M';
  }

  private statusForPatch(patch: StructuredPatch): string {
    if (patch.isCreate) {
      return 'added';
    }
    if (patch.isDelete) {
      return 'deleted';
    }
    if (patch.isRename) {
      return 'renamed';
    }
    if (patch.isCopy) {
      return 'copied';
    }
    return 'modified';
  }

  private statusIcon(statusChar: string): string {
    switch (statusChar.toUpperCase()) {
      case 'A':
        return 'add_circle';
      case 'D':
        return 'delete';
      case 'R':
        return 'drive_file_rename_outline';
      case 'C':
        return 'file_copy';
      default:
        return 'edit';
    }
  }

  private statusLabel(statusChar: string, status: string): string {
    const cleanedStatus = status.trim();
    if (cleanedStatus !== '') {
      return cleanedStatus;
    }

    switch (statusChar.toUpperCase()) {
      case 'A':
        return 'added';
      case 'D':
        return 'deleted';
      case 'R':
        return 'renamed';
      case 'C':
        return 'copied';
      default:
        return 'modified';
    }
  }

  private lineSymbol(kind: RenderedDiffLineKind): string {
    switch (kind) {
      case 'added':
        return '+';
      case 'removed':
        return '-';
      default:
        return '';
    }
  }

  private stripDiffMarker(content: string): string {
    if (content.startsWith('+') || content.startsWith('-') || content.startsWith(' ')) {
      return content.slice(1);
    }
    return content;
  }
}

/**
 * Splits highlighted HTML into lines, closing open spans at each line break
 * and reopening them on the next line so every line is self-contained.
 */
function splitHighlightedHtml(html: string, expectedLines: number): string[] {
  const lines: string[] = [];
  const openTags: string[] = [];
  let current = '';
  let i = 0;

  while (i < html.length) {
    const char = html[i];
    if (char === '\n') {
      lines.push(current + '</span>'.repeat(openTags.length));
      current = openTags.join('');
      i++;
      continue;
    }
    if (char === '<') {
      const tagEnd = html.indexOf('>', i);
      const next = tagEnd === -1 ? html.length : tagEnd + 1;
      const tag = html.slice(i, next);
      if (tag.startsWith('</')) {
        openTags.pop();
      } else {
        openTags.push(tag);
      }
      current += tag;
      i = next;
      continue;
    }
    current += char;
    i++;
  }

  lines.push(current);
  while (lines.length < expectedLines) {
    lines.push('');
  }
  return lines;
}
