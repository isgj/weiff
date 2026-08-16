import { Component, computed, inject, Signal, signal } from '@angular/core';
import { form, FormField, required, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TagMutation } from '../../data/repo-api';

export interface TagDialogData {
  rev: string;
  revLabel: string;
  revReadonly: boolean;
  existingNames: Signal<string[]>;
}

const forbiddenNameCharacters = /[\s@:"'\\/]/;

@Component({
  selector: 'app-tag-create-dialog',
  imports: [
    FormField,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  templateUrl: './tag-create-dialog.html',
  styleUrl: './tag-create-dialog.scss',
})
export class TagCreateDialog {
  private readonly dialogRef = inject<MatDialogRef<TagCreateDialog, TagMutation>>(MatDialogRef);
  protected readonly data = inject<TagDialogData>(MAT_DIALOG_DATA);

  private readonly model = signal({ name: '', revision: this.data.rev });

  protected readonly f = form(this.model, (p) => {
    required(p.name, { message: 'Tag name is required' });
    validate(p.name, ({ value }) => {
      const name = value().trim();
      if (name === '') {
        return undefined;
      }
      if (forbiddenNameCharacters.test(name)) {
        return {
          kind: 'invalidName',
          message: 'Name cannot contain spaces, @, /, :, quotes, or backslashes',
        };
      }
      if (name.startsWith('-')) {
        return {
          kind: 'invalidName',
          message: 'Name cannot start with "-"',
        };
      }
      return undefined;
    });
    required(p.revision, { message: 'Revision is required' });
  });

  protected readonly isUpdate = computed(() =>
    this.data.existingNames().includes(this.model().name.trim()),
  );

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
      allowMove: this.isUpdate(),
    });
  }
}
