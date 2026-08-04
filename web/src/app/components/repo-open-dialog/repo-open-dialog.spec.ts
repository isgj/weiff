import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { RepoOpenDialog } from './repo-open-dialog';

describe('RepoOpenDialog', () => {
  let component: RepoOpenDialog;
  let fixture: ComponentFixture<RepoOpenDialog>;
  let httpMock: HttpTestingController;
  let closedValue: unknown;

  beforeEach(async () => {
    closedValue = undefined;
    await TestBed.configureTestingModule({
      imports: [RepoOpenDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: { repoPath: '/tmp/repo', knownPaths: ['/tmp/repo', '/tmp/other'] },
        },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => (closedValue = value) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RepoOpenDialog);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await flushBrowse();
    await fixture.whenStable();
  });

  async function flushBrowse(): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const requests = httpMock.match((req) => req.url.startsWith('/api/browse/dirs'));
      if (requests.length > 0) {
        for (const req of requests) {
          req.flush({
            path: '/tmp/repo',
            parent: '/tmp',
            isRepo: true,
            dirs: [
              { name: 'nested', path: '/tmp/repo/nested', isRepo: false },
              { name: 'sub-repo', path: '/tmp/repo/sub-repo', isRepo: true },
            ],
          });
        }
        return;
      }

      await Promise.resolve();
    }
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('prefills the path from dialog data', () => {
    const pathInput = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(pathInput.value).toBe('/tmp/repo');
  });

  it('lists directories from the browse endpoint', () => {
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('nested');
    expect(text).toContain('sub-repo');
  });

  it('closes with the path only when no name is entered', () => {
    const controls = component as unknown as { open(): void };
    controls.open();

    expect(closedValue).toEqual({ path: '/tmp/repo' });
  });

  it('closes with the path and trimmed name when a name is entered', async () => {
    const inputs = fixture.nativeElement.querySelectorAll('input');
    const nameInput = inputs[inputs.length - 1] as HTMLInputElement;
    nameInput.value = '  My repo  ';
    nameInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const controls = component as unknown as { open(): void };
    controls.open();

    expect(closedValue).toEqual({ path: '/tmp/repo', name: 'My repo' });
  });

  it('rejects an empty path', async () => {
    const pathInput = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    pathInput.value = '';
    pathInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const controls = component as unknown as { open(): void };
    controls.open();

    expect(closedValue).toBeUndefined();
  });

  it('sets the path when a repo directory is picked', async () => {
    const controls = component as unknown as { pickDirectory(path: string): void };
    controls.pickDirectory('/tmp/repo/sub-repo');
    fixture.detectChanges();
    await flushBrowse();
    fixture.detectChanges();

    const pathInput = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(pathInput.value).toBe('/tmp/repo/sub-repo');
  });
});
