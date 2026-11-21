import { Component, computed, inject, Signal, signal } from '@angular/core';
import { form, FormField, readonly, required, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BookmarkMutation } from '../../data/repo-api';

export interface BookmarkDialogData {
  rev: string;
  revLabel: string;
  revReadonly: boolean;
  existingNames: Signal<string[]>;
}

const forbiddenNameCharacters = /[\s@:"'\\]/;

@Component({
  selector: 'app-bookmark-create-dialog',
  imports: [
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
  ],
  templateUrl: './bookmark-create-dialog.html',
  styleUrl: './bookmark-create-dialog.scss',
})
export class BookmarkCreateDialog {
  private readonly dialogRef =
    inject<MatDialogRef<BookmarkCreateDialog, BookmarkMutation>>(MatDialogRef);
  protected readonly data = inject<BookmarkDialogData>(MAT_DIALOG_DATA);

  private readonly model = signal({ name: '', revision: this.data.rev });

  protected readonly f = form(this.model, (p) => {
    required(p.name, { message: 'Bookmark name is required' });
    validate(p.name, ({ value }) => {
      const name = value().trim();
      if (name === '') {
        return undefined;
      }
      if (forbiddenNameCharacters.test(name)) {
        return {
          kind: 'invalidName',
          message: 'Name cannot contain spaces, @, :, quotes, or backslashes',
        };
      }
      if (name.startsWith('-') || name.startsWith('.') || name.endsWith('.')) {
        return {
          kind: 'invalidName',
          message: 'Name cannot start with "-" or start/end with "."',
        };
      }
      return undefined;
    });
    required(p.revision, { message: 'Revision is required' });
    readonly(p.revision, { when: () => this.data.revReadonly });
  });

  protected readonly isUpdate = computed(() =>
    this.data.existingNames().includes(this.model().name.trim()),
  );

  protected readonly allowBackwards = signal(true);
  protected readonly ignoreImmutable = signal(false);

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected save(): void {
    if (!this.f().valid()) {
      return;
    }

    const value = this.model();
    this.dialogRef.close({
      name: value.name.trim(),
      rev: value.revision.trim(),
      allowBackwards: this.allowBackwards(),
      ignoreImmutable: this.ignoreImmutable(),
    });
  }
}
