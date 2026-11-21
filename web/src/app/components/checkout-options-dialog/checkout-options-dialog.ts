import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CheckoutOptions } from '../../data/repo-api';

@Component({
  selector: 'app-checkout-options-dialog',
  imports: [MatButtonModule, MatCheckboxModule, MatDialogModule, MatIconModule, MatTooltipModule],
  templateUrl: './checkout-options-dialog.html',
  styleUrl: './checkout-options-dialog.scss',
})
export class CheckoutOptionsDialog {
  private readonly dialogRef =
    inject<MatDialogRef<CheckoutOptionsDialog, CheckoutOptions>>(MatDialogRef);
  protected readonly data = inject<CheckoutOptions>(MAT_DIALOG_DATA);

  protected readonly ignoreImmutable = signal(this.data.ignoreImmutable);
  protected readonly ignoreWorkingCopy = signal(this.data.ignoreWorkingCopy);
  protected readonly noIntegrateOperation = signal(this.data.noIntegrateOperation);

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected save(): void {
    this.dialogRef.close({
      ignoreImmutable: this.ignoreImmutable(),
      ignoreWorkingCopy: this.ignoreWorkingCopy(),
      noIntegrateOperation: this.noIntegrateOperation(),
    });
  }
}
