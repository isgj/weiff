import { Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Commit, GraphRow as RepoGraphRow } from '../../data/repo-api';
import { GraphSvg } from './graph-svg';

interface CommitGraphGroup {
  commit: Commit | null;
  rows: CommitGraphRow[];
  key: string;
  title: string;
}

interface CommitGraphRow {
  kind: 'node' | 'meta' | 'connector';
  graph: string;
  content: string;
  key: string;
}

const nodeChars = new Set(['@', '○', '◆', '×', '◌']);
const branchChars = new Set(['─', '╮', '╯', '╭', '╰', '├', '┤']);

@Component({
  selector: 'app-commit-graph',
  imports: [
    GraphSvg,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatListModule,
    MatMenuModule,
    MatTooltipModule,
    RouterLink,
  ],
  templateUrl: './commit-graph.html',
  styleUrl: './commit-graph.scss',
})
export class CommitGraph {
  readonly commits = input<Commit[], Commit[] | null | undefined>([], {
    transform: (value) => value ?? [],
  });
  readonly graphRows = input<RepoGraphRow[], RepoGraphRow[] | null | undefined>([], {
    transform: (value) => value ?? [],
  });
  readonly currentCommitId = input('');
  readonly selectedCommitId = input('');

  readonly commitSelected = output<string>();
  readonly checkoutRequested = output<string>();
  readonly abandonRequested = output<string>();
  readonly newFromRequested = output<string>();
  readonly rebaseRequested = output<string>();

  protected readonly groups = computed(() => this.buildGroups(this.commits()));
  protected readonly graphWidth = computed(() =>
    Math.max(
      3,
      ...this.groups().flatMap((group) => group.rows.map((row) => this.graphWidthFor(row.graph))),
    ),
  );

  protected select(commit: Commit): void {
    this.commitSelected.emit(this.revFor(commit));
  }

  protected checkout(commit: Commit, event: Event): void {
    event.stopPropagation();
    this.checkoutRequested.emit(this.revFor(commit));
  }

  protected abandon(commit: Commit, event: Event): void {
    event.stopPropagation();
    this.abandonRequested.emit(this.revFor(commit));
  }

  protected newFrom(commit: Commit, event: Event): void {
    event.stopPropagation();
    this.newFromRequested.emit(this.revFor(commit));
  }

  protected rebase(commit: Commit, event: Event): void {
    event.stopPropagation();
    this.rebaseRequested.emit(this.revFor(commit));
  }

  protected idTitle(label: string, id: string): string {
    return `${label}: ${id}`;
  }

  protected changeLabel(commit: Commit): string {
    const label = commit.shortChangeId || commit.changeId;
    if (commit.divergent === true && commit.changeOffset != null) {
      return `${label}/${commit.changeOffset}`;
    }

    return label;
  }

  protected divergentTitle(commit: Commit): string {
    return [
      'Divergent change: multiple visible commits share this change ID.',
      `Change: ${commit.changeId}`,
      `Selected commit: ${commit.commitId}`,
    ].join('\n');
  }

  protected authoredAt(commit: Commit): string {
    if (commit.authorTimestamp === '') {
      return 'unknown date';
    }

    const timestamp = new Date(commit.authorTimestamp);
    if (Number.isNaN(timestamp.valueOf())) {
      return commit.authorTimestamp;
    }

    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp);
  }

  private buildGroups(commits: Commit[]): CommitGraphGroup[] {
    const commitsById = new Map(commits.map((commit) => [commit.commitId, commit]));
    const graphRows = this.graphRows();
    if (graphRows.length > 0) {
      const groups: CommitGraphGroup[] = [];

      graphRows.forEach((row, index) => {
        const commit = row.commitId == null ? null : (commitsById.get(row.commitId) ?? null);
        if (commit == null) {
          const connector = this.connectorRow(row.graph || ' ', `${index}:connector`);
          groups.push({
            commit: null,
            rows: [connector],
            key: `${index}:connector-group`,
            title: connector.content || 'Graph connector',
          });
          return;
        }

        groups.push(this.groupForCommit(commit, row.graph || ' ', `${index}:${commit.commitId}`));
      });

      return groups;
    }

    return commits.map((commit, index) =>
      this.groupForCommit(commit, commit.current ? '@' : '○', `${index}:${commit.commitId}`),
    );
  }

  private groupForCommit(commit: Commit, graph: string, keyPrefix: string): CommitGraphGroup {
    return {
      commit,
      rows: this.rowsForCommit(graph, keyPrefix),
      key: `${keyPrefix}:group`,
      title: this.commitTitle(commit),
    };
  }

  private rowsForCommit(graph: string, keyPrefix: string): CommitGraphRow[] {
    const rows: CommitGraphRow[] = [
      {
        kind: 'node',
        graph,
        content: '',
        key: `${keyPrefix}:node`,
      },
    ];
    const continuation = this.continuationGutter(graph);
    rows.push({
      kind: 'meta',
      graph: continuation,
      content: '',
      key: `${keyPrefix}:meta`,
    });
    return rows;
  }

  private connectorRow(graph: string, keyPrefix: string): CommitGraphRow {
    const connector = this.splitConnector(graph);
    return {
      kind: 'connector',
      graph: connector.graph,
      content: connector.content,
      key: `${keyPrefix}:${graph}`,
    };
  }

  private splitConnector(graph: string): Pick<CommitGraphRow, 'graph' | 'content'> {
    const contentStart = graph.indexOf('(');
    if (contentStart <= 0) {
      return { graph, content: '' };
    }

    return {
      graph: graph.slice(0, contentStart),
      content: graph.slice(contentStart).trim(),
    };
  }

  private continuationGutter(graph: string): string {
    let result = '';
    for (const char of graph) {
      if (nodeChars.has(char)) {
        result += '│';
      } else if (branchChars.has(char)) {
        result += ' ';
      } else {
        result += char;
      }
    }
    return result;
  }

  private graphWidthFor(graph: string): number {
    return [...graph].length;
  }

  private revFor(commit: Commit): string {
    return commit.commitId || commit.changeId;
  }

  private commitTitle(commit: Commit): string {
    const lines = [
      commit.summary,
      `Commit: ${commit.commitId}`,
      `Change: ${commit.changeId}`,
      `Author: ${commit.authorName || 'unknown author'} <${commit.authorEmail || 'unknown email'}>`,
      `Time: ${commit.authorTimestamp || 'unknown time'}`,
    ];
    if (commit.divergent === true) {
      lines.splice(1, 0, this.divergentTitle(commit));
    }
    return lines.join('\n');
  }
}
