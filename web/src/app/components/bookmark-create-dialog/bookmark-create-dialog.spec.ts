import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { BookmarkCreateDialog, BookmarkDialogData } from './bookmark-create-dialog';

describe('BookmarkCreateDialog', () => {
  let closedValue: unknown;

  async function createDialog(
    revReadonly: boolean,
  ): Promise<ComponentFixture<BookmarkCreateDialog>> {
    closedValue = undefined;
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
        { provide: MatDialogRef, useValue: { close: (value: unknown) => (closedValue = value) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(BookmarkCreateDialog);
    await fixture.whenStable();
    return fixture;
  }

  function textInputs(fixture: ComponentFixture<BookmarkCreateDialog>): HTMLInputElement[] {
    const root = fixture.nativeElement as HTMLElement;
    return Array.from(root.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])'));
  }

  function revisionInput(fixture: ComponentFixture<BookmarkCreateDialog>): HTMLInputElement {
    const inputs = textInputs(fixture);
    return inputs[inputs.length - 1];
  }

  it('makes the revision read-only when opened from a revision', async () => {
    const fixture = await createDialog(true);

    expect(revisionInput(fixture).readOnly).toBe(true);
  });

  it('allows editing the revision when opened from the bookmarks page', async () => {
    const fixture = await createDialog(false);

    expect(revisionInput(fixture).readOnly).toBe(false);
  });

  it('emits the chosen option flags', async () => {
    const fixture = await createDialog(false);
    const root = fixture.nativeElement as HTMLElement;
    const nameInput = textInputs(fixture)[0];
    nameInput.value = 'my-bookmark';
    nameInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const checkboxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    checkboxes[1].click();
    await fixture.whenStable();

    (fixture.componentInstance as unknown as { save(): void }).save();

    expect(closedValue).toEqual({
      name: 'my-bookmark',
      rev: 'abc123',
      allowBackwards: true,
      ignoreImmutable: true,
    });
  });
});
