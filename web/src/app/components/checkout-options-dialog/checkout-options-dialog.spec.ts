import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { DEFAULT_CHECKOUT_OPTIONS } from '../../data/repo-api';
import { CheckoutOptionsDialog } from './checkout-options-dialog';

describe('CheckoutOptionsDialog', () => {
  let fixture: ComponentFixture<CheckoutOptionsDialog>;
  let closedValue: unknown;

  beforeEach(async () => {
    closedValue = undefined;
    await TestBed.configureTestingModule({
      imports: [CheckoutOptionsDialog],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: DEFAULT_CHECKOUT_OPTIONS },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => (closedValue = value) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckoutOptionsDialog);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('closes with the selected options', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const checkboxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    checkboxes[0].click();
    checkboxes[2].click();
    await fixture.whenStable();

    const controls = fixture.componentInstance as unknown as { save(): void };
    controls.save();

    expect(closedValue).toEqual({
      ignoreImmutable: true,
      ignoreWorkingCopy: false,
      noIntegrateOperation: true,
    });
  });

  it('closes without options on cancel', () => {
    const controls = fixture.componentInstance as unknown as { cancel(): void };
    controls.cancel();

    expect(closedValue).toBeUndefined();
  });
});
