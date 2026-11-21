import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { TagCreateDialog, TagDialogData } from './tag-create-dialog';

describe('TagCreateDialog', () => {
  async function createDialog(revReadonly: boolean): Promise<ComponentFixture<TagCreateDialog>> {
    await TestBed.configureTestingModule({
      imports: [TagCreateDialog],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            rev: 'abc123',
            revLabel: 'feat: example',
            revReadonly,
            existingNames: signal([]),
          } satisfies TagDialogData,
        },
        { provide: MatDialogRef, useValue: { close: () => undefined } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TagCreateDialog);
    await fixture.whenStable();
    return fixture;
  }

  function revisionInput(fixture: ComponentFixture<TagCreateDialog>): HTMLInputElement {
    const inputs = fixture.nativeElement.querySelectorAll('input');
    return inputs[inputs.length - 1] as HTMLInputElement;
  }

  it('makes the revision read-only when opened from a revision', async () => {
    const fixture = await createDialog(true);

    expect(revisionInput(fixture).readOnly).toBe(true);
  });

  it('allows editing the revision when opened from the tags page', async () => {
    const fixture = await createDialog(false);

    expect(revisionInput(fixture).readOnly).toBe(false);
  });
});
