import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { ConfirmDialog, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog';
import { OperationEntry } from '../../data/repo-api';
import { RevisionDashboardState } from '../../data/revision-dashboard-state';

@Component({
  selector: 'app-operation-log-page',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatTableModule,
  ],
  templateUrl: './operation-log-page.html',
  styleUrl: './operation-log-page.scss',
})
export class OperationLogPage {
  private readonly dialog = inject(MatDialog);
  protected readonly dashboard = inject(RevisionDashboardState);
  protected readonly operationColumns = [
    'operation',
    'user',
    'time',
    'status',
    'description',
    'actions',
  ];
  protected readonly pageSizeOptions = [10, 25, 50, 100];
  protected readonly page = signal({ pageIndex: 0, pageSize: 10 });
  protected readonly filter = signal('');
  protected readonly operations = computed(() => this.dashboard.operations());
  protected readonly filteredOperations = computed(() => {
    const filter = this.filter().trim().toLocaleLowerCase();
    if (filter === '') {
      return this.operations();
    }

    return this.operations().filter((operation) => this.matchesFilter(operation, filter));
  });
  protected readonly pageIndex = computed(() =>
    safePageIndex(this.page().pageIndex, this.page().pageSize, this.filteredOperations().length),
  );
  protected readonly pagedOperations = computed(() => {
    const operations = this.filteredOperations();
    const page = this.page();
    const pageIndex = safePageIndex(page.pageIndex, page.pageSize, operations.length);
    const start = pageIndex * page.pageSize;
    return operations.slice(start, start + page.pageSize);
  });

  protected restoreOperation(operation: OperationEntry): void {
    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: {
        title: 'Restore operation',
        message: `Restore the repository to operation ${operation.shortId || operation.id}? Later operations are undone (this itself is recorded and can be undone).`,
        confirmLabel: 'Restore',
        icon: 'settings_backup_restore',
      },
    });

    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed !== true) {
        return;
      }

      this.dashboard.restoreOperation(operation.id);
    });
  }

  protected setFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
    this.page.update((page) => ({ ...page, pageIndex: 0 }));
  }

  protected clearFilter(): void {
    this.filter.set('');
    this.page.update((page) => ({ ...page, pageIndex: 0 }));
  }

  protected setPage(event: PageEvent): void {
    this.page.set({
      pageIndex: event.pageIndex,
      pageSize: event.pageSize,
    });
  }

  protected loadOlderOperations(): void {
    this.dashboard.loadOlderOperations();
  }

  protected operationTitle(operation: OperationEntry): string {
    return [
      `Operation: ${operation.id}`,
      `User: ${operation.user || 'unknown user'}`,
      `Time: ${operation.timestamp || 'unknown time'}`,
      `Command: ${this.commandText(operation) || 'unknown command'}`,
      `Status: ${this.statusLabel(operation)}`,
      `Workspace: ${operation.workspaceName || 'none'}`,
      `Attributes: ${operation.attributes || 'none'}`,
      `Parents: ${operation.parents.join(', ') || 'none'}`,
    ].join('\n');
  }

  protected userDisplay(operation: OperationEntry): string {
    const user = operation.user.trim();
    if (user === '') {
      return 'unknown';
    }

    return user.split('@', 1)[0] || user;
  }

  protected userInitials(operation: OperationEntry): string {
    const display = this.userDisplay(operation);
    const parts = display.split(/[._\-\s]+/).filter(Boolean);
    const initials = parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');

    return initials || display.slice(0, 2).toUpperCase();
  }

  protected relativeTime(operation: OperationEntry): string {
    if (operation.timestamp === '') {
      return 'unknown time';
    }

    const date = new Date(operation.timestamp);
    if (Number.isNaN(date.valueOf())) {
      return operation.timestamp;
    }

    const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000);
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
      ['year', 60 * 60 * 24 * 365],
      ['month', 60 * 60 * 24 * 30],
      ['day', 60 * 60 * 24],
      ['hour', 60 * 60],
      ['minute', 60],
      ['second', 1],
    ];
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    for (const [unit, seconds] of units) {
      if (Math.abs(deltaSeconds) >= seconds || unit === 'second') {
        return formatter.format(Math.round(deltaSeconds / seconds), unit);
      }
    }

    return this.formattedTime(operation);
  }

  protected formattedTime(operation: OperationEntry): string {
    if (operation.timestamp === '') {
      return 'unknown time';
    }

    const date = new Date(operation.timestamp);
    if (Number.isNaN(date.valueOf())) {
      return operation.timestamp;
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  protected hasDetails(operation: OperationEntry): boolean {
    return operation.current || operation.snapshot || operation.root;
  }

  protected commandText(operation: OperationEntry): string {
    return commandText(operation);
  }

  protected statusLabel(operation: OperationEntry): string {
    if (operation.root) {
      return 'Root';
    }
    if (operation.current) {
      return 'Current';
    }
    if (operation.snapshot) {
      return 'Snapshot';
    }

    return 'Operation';
  }

  protected copyOperationID(operation: OperationEntry): void {
    this.copyText(operation.id);
  }

  protected copyCommand(operation: OperationEntry): void {
    this.copyText(this.commandText(operation));
  }

  protected copyParentIDs(operation: OperationEntry): void {
    this.copyText(operation.parents.join('\n'));
  }

  private matchesFilter(operation: OperationEntry, filter: string): boolean {
    return [
      operation.id,
      operation.shortId,
      operation.description,
      operation.user,
      this.userDisplay(operation),
      operation.timestamp,
      operation.workspaceName,
      operation.attributes,
      this.commandText(operation),
      this.statusLabel(operation),
      ...operation.parents,
      ...operation.shortParents,
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(filter);
  }

  private copyText(value: string): void {
    const text = value.trim();
    if (text === '') {
      return;
    }

    void globalThis.navigator?.clipboard?.writeText(text);
  }
}

function safePageIndex(pageIndex: number, pageSize: number, totalRows: number): number {
  if (pageSize <= 0 || totalRows <= 0) {
    return 0;
  }

  return Math.min(pageIndex, Math.max(0, Math.ceil(totalRows / pageSize) - 1));
}

function commandText(operation: OperationEntry): string {
  const match = /^args:\s*(.+)$/m.exec(operation.attributes);
  return (match?.[1] ?? '').trim();
}
