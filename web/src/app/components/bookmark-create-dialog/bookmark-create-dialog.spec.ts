import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { BookmarkCreateDialog, BookmarkDialogData } from './bookmark-create-dialog';

describe('BookmarkCreateDialog', () => {
  async function createDialog(
    revReadonly: boolean,
  ): Promise<ComponentFixture<BookmarkCreateDialog>> {
    await TestBed.configureTestingModule({
      imports: [BookmarkCreateDialog],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            rev: 'abc123',
            revLabel: 'feat: example',
            revReadonly,
            existingNames: signal([]),
          } satisfies BookmarkDialogData,
        },
        { provide: MatDialogRef, useValue: { close: () => undefined } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(BookmarkCreateDialog);
    await fixture.whenStable();
    return fixture;
  }

  function revisionInput(fixture: ComponentFixture<BookmarkCreateDialog>): HTMLInputElement {
    const inputs = fixture.nativeElement.querySelectorAll('input');
    return inputs[inputs.length - 1] as HTMLInputElement;
  }

  it('makes the revision read-only when opened from a revision', async () => {
    const fixture = await createDialog(true);

    expect(revisionInput(fixture).readOnly).toBe(true);
  });

  it('allows editing the revision when opened from the bookmarks page', async () => {
    const fixture = await createDialog(false);

    expect(revisionInput(fixture).readOnly).toBe(false);
  });
});
