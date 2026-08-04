import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField, required } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { WorkspaceMutation } from '../../data/repo-api';

export type SparseMode = 'copy' | 'full' | 'empty';

interface SparseOption {
  value: SparseMode;
  label: string;
  icon: string;
}

const sparseOptions: SparseOption[] = [
  { value: 'copy', label: 'Copy sparse patterns', icon: 'content_copy' },
  { value: 'full', label: 'Full checkout', icon: 'folder_open' },
  { value: 'empty', label: 'Empty checkout', icon: 'folder_off' },
];

export interface WorkspaceDialogData {
  parentRev: string;
  parentLabel: string;
}

@Component({
  selector: 'app-workspace-create-dialog',
  imports: [
    FormField,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './workspace-create-dialog.html',
  styleUrl: './workspace-create-dialog.scss',
})
export class WorkspaceCreateDialog {
  private readonly dialogRef =
    inject<MatDialogRef<WorkspaceCreateDialog, WorkspaceMutation>>(MatDialogRef);
  protected readonly data = inject<WorkspaceDialogData>(MAT_DIALOG_DATA);

  private readonly model = signal({
    destination: '',
    name: '',
    revision: '',
    message: '',
    sparseMode: 'copy' as SparseMode,
  });

  protected readonly f = form(this.model, (p) => {
    required(p.destination, { message: 'Directory is required' });
  });

  protected readonly sparseOptions = sparseOptions;
  protected readonly selectedSparseOption = computed(
    () =>
      sparseOptions.find((option) => option.value === this.model().sparseMode) ?? sparseOptions[0],
  );
  protected readonly parentRevisionPlaceholder = computed(() =>
    this.data.parentRev === '@' ? 'Current revision (@)' : this.data.parentRev,
  );
  protected readonly effectiveRevision = computed(
    () => this.model().revision.trim() || this.data.parentRev,
  );
  protected readonly canCreateWorkspace = computed(
    () => this.f().valid() && this.effectiveRevision().trim() !== '',
  );

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected save(): void {
    if (!this.canCreateWorkspace()) {
      return;
    }

    const value = this.model();
    const request: WorkspaceMutation = {
      destination: value.destination.trim(),
      rev: this.effectiveRevision().trim(),
      sparsePatterns: value.sparseMode,
    };
    const name = optionalString(value.name);
    if (name != null) {
      request.name = name;
    }
    const message = optionalString(value.message);
    if (message != null) {
      request.message = message;
    }

    this.dialogRef.close(request);
  }
}

function optionalString(value: string): string | undefined {
  const cleaned = value.trim();
  return cleaned === '' ? undefined : cleaned;
}
