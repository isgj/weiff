import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { DescribeDialog } from './describe-dialog';

describe('DescribeDialog', () => {
  let component: DescribeDialog;
  let fixture: ComponentFixture<DescribeDialog>;
  let closedValue: unknown;

  beforeEach(async () => {
    closedValue = undefined;
    await TestBed.configureTestingModule({
      imports: [DescribeDialog],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: { rev: 'abc', title: 'feat: old title', body: 'old body' },
        },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => (closedValue = value) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DescribeDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('prefills the title and body from dialog data', () => {
    const titleInput = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const bodyInput = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;

    expect(titleInput.value).toBe('feat: old title');
    expect(bodyInput.value).toBe('old body');
  });

  it('closes with the trimmed title and body on save', () => {
    const controls = component as unknown as { save(): void };

    controls.save();

    expect(closedValue).toEqual({ title: 'feat: old title', body: 'old body' });
  });

  it('rejects a body without a title', async () => {
    const titleInput = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    titleInput.value = '';
    titleInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const controls = component as unknown as { save(): void };
    controls.save();

    expect(closedValue).toBeUndefined();
  });

  it('allows clearing both fields', async () => {
    const titleInput = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const bodyInput = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    titleInput.value = '';
    titleInput.dispatchEvent(new Event('input'));
    bodyInput.value = '';
    bodyInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const controls = component as unknown as { save(): void };
    controls.save();

    expect(closedValue).toEqual({ title: '', body: '' });
  });
});
