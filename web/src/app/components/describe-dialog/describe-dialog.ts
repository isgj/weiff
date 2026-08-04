import { Component, inject, signal } from '@angular/core';
import { form, FormField, validate } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ChangeDescription } from '../../data/repo-api';

export interface DescribeDialogData {
  rev: string;
  title: string;
  body: string;
}

@Component({
  selector: 'app-describe-dialog',
  imports: [
    FormField,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  templateUrl: './describe-dialog.html',
  styleUrl: './describe-dialog.scss',
})
export class DescribeDialog {
  private readonly dialogRef =
    inject<MatDialogRef<DescribeDialog, ChangeDescription>>(MatDialogRef);
  protected readonly data = inject<DescribeDialogData>(MAT_DIALOG_DATA);

  private readonly model = signal({ title: this.data.title, body: this.data.body });

  protected readonly f = form(this.model, (p) => {
    validate(p.title, ({ value, valueOf }) => {
      if (value().trim() === '' && valueOf(p.body).trim() !== '') {
        return { kind: 'required', message: 'Title is required when a body is provided' };
      }
      return undefined;
    });
  });

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected save(): void {
    if (!this.f().valid()) {
      return;
    }

    const value = this.model();
    this.dialogRef.close({ title: value.title.trim(), body: value.body.trimEnd() });
  }
}
