import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-auth-token-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Authentication required</h2>
    <form (submit)="submit(token.value); $event.preventDefault()">
      <mat-dialog-content>
        <p>Enter the Weiff access token to continue.</p>
        <mat-form-field appearance="outline">
          <mat-label>Access token</mat-label>
          <input #token matInput type="password" autocomplete="current-password" required />
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-flat-button type="submit" [disabled]="token.value.trim() === ''">
          Continue
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
      margin-top: 0.5rem;
    }

    mat-dialog-actions {
      gap: 0.5rem;
    }
  `,
})
export class AuthTokenDialog {
  protected readonly dialogRef = inject<MatDialogRef<AuthTokenDialog, string>>(MatDialogRef);

  protected submit(token: string): void {
    if (token.trim() !== '') {
      this.dialogRef.close(token.trim());
    }
  }
}
