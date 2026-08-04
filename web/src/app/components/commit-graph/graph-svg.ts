import { Component, computed, input } from '@angular/core';

interface GutterCell {
  char: string;
  col: number;
  lane: number;
  key: string;
}

const cellWidth = 10;
const defaultRowHeight = 22;
const lineWidth = 2;
const nodeRadius = 4;
const workingCopyRadius = 5;
const nodeGap = 7;
const lineOpacity = 0.48;
const nodeOpacity = 0.82;
const elidedOpacity = 0.34;
const graphColors = [
  'var(--color-graph-lane-0)',
  'var(--color-graph-lane-1)',
  'var(--color-graph-lane-2)',
  'var(--color-graph-lane-3)',
  'var(--color-graph-lane-4)',
  'var(--color-graph-lane-5)',
  'var(--color-graph-lane-6)',
  'var(--color-graph-lane-7)',
];
const nodeChars = new Set(['@', '○', '◆', '×', '◌']);
const horizontalChars = new Set(['─', '├', '┤', '╮', '╯', '╭', '╰']);

@Component({
  selector: 'app-graph-svg',
  templateUrl: './graph-svg.html',
  styleUrl: './graph-svg.scss',
  host: { '[style.height.px]': 'height()' },
})
export class GraphSvg {
  readonly gutter = input('');
  readonly gutterWidth = input(3);
  readonly divergent = input(false);
  readonly height = input(defaultRowHeight);

  protected readonly lineWidth = lineWidth;
  protected readonly nodeRadius = nodeRadius;
  protected readonly workingCopyRadius = workingCopyRadius;
  protected readonly nodeGap = nodeGap;
  protected readonly lineOpacity = lineOpacity;
  protected readonly nodeOpacity = nodeOpacity;
  protected readonly elidedOpacity = elidedOpacity;
  protected readonly cells = computed(() => parseGutter(this.gutter()));
  protected readonly svgWidth = computed(
    () => Math.max(this.gutterWidth(), countChars(this.gutter()), 3) * cellWidth,
  );

  protected get rowHeight(): number {
    return this.height();
  }

  protected get centerY(): number {
    return this.height() / 2;
  }

  protected centerX(col: number): number {
    return col * cellWidth + cellWidth / 2;
  }

  protected laneColor(lane: number): string {
    return graphColors[mod(lane, graphColors.length)];
  }

  protected isNode(char: string): boolean {
    return nodeChars.has(char);
  }

  protected curvePath(char: string, col: number): string {
    const x = this.centerX(col);
    const cy = this.centerY;
    const h = this.rowHeight;
    switch (char) {
      case '╮':
        return `M ${x - cellWidth / 2} ${cy} Q ${x} ${cy} ${x} ${h}`;
      case '╯':
        return `M ${x} 0 Q ${x} ${cy} ${x - cellWidth / 2} ${cy}`;
      case '╭':
        return `M ${x + cellWidth / 2} ${cy} Q ${x} ${cy} ${x} ${h}`;
      case '╰':
        return `M ${x} 0 Q ${x} ${cy} ${x + cellWidth / 2} ${cy}`;
      default:
        return '';
    }
  }
}

function parseGutter(gutter: string): GutterCell[] {
  const cells = [...gutter].map((char, col) => ({
    char,
    col,
    lane: Math.floor(col / 2),
    key: `${col}:${char}`,
  }));

  let runStart = -1;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].char === '─') {
      if (runStart < 0) {
        runStart = i;
      }
    } else if (runStart >= 0) {
      closeHorizontalRun(cells, runStart, i);
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    closeHorizontalRun(cells, runStart, cells.length);
  }

  return cells;
}

function closeHorizontalRun(cells: GutterCell[], start: number, end: number): void {
  let lane = cells[start].lane;
  if (start > 0 && horizontalChars.has(cells[start - 1].char)) {
    lane = Math.max(lane, cells[start - 1].lane);
  }
  if (end < cells.length && horizontalChars.has(cells[end].char)) {
    lane = Math.max(lane, cells[end].lane);
  }
  for (let i = start; i < end; i++) {
    cells[i].lane = lane;
  }
}

function countChars(value: string): number {
  return [...value].length;
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
