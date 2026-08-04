import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField, required } from '@angular/forms/signals';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { BrowseDirsResult } from '../../data/repo-api';

export interface RepoOpenDialogData {
  repoPath: string;
  knownPaths: string[];
}

export interface RepoOpenDialogResult {
  path: string;
  name?: string;
}

@Component({
  selector: 'app-repo-open-dialog',
  imports: [
    FormField,
    MatAutocompleteModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './repo-open-dialog.html',
  styleUrl: './repo-open-dialog.scss',
})
export class RepoOpenDialog {
  private readonly dialogRef =
    inject<MatDialogRef<RepoOpenDialog, RepoOpenDialogResult>>(MatDialogRef);
  private readonly data = inject<RepoOpenDialogData>(MAT_DIALOG_DATA);

  private readonly model = signal({ path: this.data.repoPath, name: '' });

  protected readonly f = form(this.model, (p) => {
    required(p.path, { message: 'Repository path is required' });
  });

  protected readonly browsePath = signal(this.data.repoPath.trim());
  protected readonly dirsResource = httpResource<BrowseDirsResult>(() => {
    const path = this.browsePath().trim();
    const query = path === '' ? '' : `?${new URLSearchParams({ path }).toString()}`;
    return `/api/browse/dirs${query}`;
  });

  protected readonly pathSuggestions = computed(() => {
    const draft = this.model().path.trim().toLowerCase();
    const paths = this.data.knownPaths;
    if (draft === '') {
      return paths;
    }

    return paths.filter((path) => path.toLowerCase().includes(draft));
  });

  protected readonly namePlaceholder = computed(() => {
    const base = basename(this.model().path);
    return base === '' ? 'Defaults to directory name' : base;
  });

  protected browseTo(path: string): void {
    this.browsePath.set(path);
  }

  protected browseUp(): void {
    const parent = this.dirsResource.value()?.parent ?? '';
    if (parent !== '') {
      this.browsePath.set(parent);
    }
  }

  protected pickDirectory(path: string): void {
    this.model.update((value) => ({ ...value, path }));
    this.browsePath.set(path);
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected open(): void {
    if (!this.f().valid()) {
      return;
    }

    const value = this.model();
    const name = value.name.trim();
    this.dialogRef.close({
      path: value.path.trim(),
      ...(name === '' ? {} : { name }),
    });
  }
}

function basename(path: string): string {
  const normalized = path.trim().replace(/\/+$/, '');
  const lastSeparator = normalized.lastIndexOf('/');
  return lastSeparator < 0 ? normalized : normalized.slice(lastSeparator + 1);
}
