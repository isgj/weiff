import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { TagCreateDialog, TagDialogData } from './tag-create-dialog';

describe('TagCreateDialog', () => {
  let closedValue: unknown;

  async function createDialog(
    revReadonly: boolean,
    existingNames: string[] = [],
  ): Promise<ComponentFixture<TagCreateDialog>> {
    closedValue = undefined;
    await TestBed.configureTestingModule({
      imports: [TagCreateDialog],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            rev: 'abc123',
            revLabel: 'feat: example',
            revReadonly,
            existingNames: signal(existingNames),
          } satisfies TagDialogData,
        },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => (closedValue = value) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TagCreateDialog);
    await fixture.whenStable();
    return fixture;
  }

  function textInputs(fixture: ComponentFixture<TagCreateDialog>): HTMLInputElement[] {
    const root = fixture.nativeElement as HTMLElement;
    return Array.from(root.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])'));
  }

  function revisionInput(fixture: ComponentFixture<TagCreateDialog>): HTMLInputElement {
    const inputs = textInputs(fixture);
    return inputs[inputs.length - 1];
  }

  it('makes the revision read-only when opened from a revision', async () => {
    const fixture = await createDialog(true);

    expect(revisionInput(fixture).readOnly).toBe(true);
  });

  it('allows editing the revision when opened from the tags page', async () => {
    const fixture = await createDialog(false);

    expect(revisionInput(fixture).readOnly).toBe(false);
  });

  it('defaults allow move for an existing tag and emits the chosen flags', async () => {
    const fixture = await createDialog(false, ['v1']);
    const root = fixture.nativeElement as HTMLElement;
    const nameInput = textInputs(fixture)[0];
    nameInput.value = 'v1';
    nameInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const checkboxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes[0].checked).toBe(true);
    checkboxes[1].click();
    await fixture.whenStable();

    (fixture.componentInstance as unknown as { save(): void }).save();

    expect(closedValue).toEqual({
      name: 'v1',
      rev: 'abc123',
      allowMove: true,
      ignoreImmutable: true,
    });
  });

  it('honors an explicit allow move override', async () => {
    const fixture = await createDialog(false, ['v1']);
    const root = fixture.nativeElement as HTMLElement;
    const nameInput = textInputs(fixture)[0];
    nameInput.value = 'v1';
    nameInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const checkboxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    checkboxes[0].click();
    await fixture.whenStable();

    (fixture.componentInstance as unknown as { save(): void }).save();

    expect((closedValue as { allowMove: boolean }).allowMove).toBe(false);
  });
});
