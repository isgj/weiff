import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;
  const open = vi.fn(() => ({ afterClosed: () => of('test-token') }));

  beforeEach(() => {
    localStorage.clear();
    open.mockReset();
    open.mockImplementation(() => ({ afterClosed: () => of('test-token') }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: MatDialog, useValue: { open } },
      ],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('prompts after an API 401, retries with the token, and stores it', async () => {
    const response = firstValueFrom(client.get<{ ok: boolean }>('/api/state'));
    http.expectOne('/api/state').flush('', { status: 401, statusText: 'Unauthorized' });

    await new Promise((resolve) => setTimeout(resolve));
    const retry = http.expectOne('/api/state');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer test-token');
    retry.flush({ ok: true });

    await expect(response).resolves.toEqual({ ok: true });
    expect(open).toHaveBeenCalledOnce();
    expect(localStorage.getItem('weiff.authToken')).toBe('test-token');

    const nextResponse = firstValueFrom(client.get<{ ok: boolean }>('/api/state'));
    const nextRequest = http.expectOne('/api/state');
    expect(nextRequest.request.headers.get('Authorization')).toBe('Bearer test-token');
    nextRequest.flush({ ok: true });
    await expect(nextResponse).resolves.toEqual({ ok: true });
  });

  it('prompts again when the entered token is rejected', async () => {
    open.mockReturnValueOnce({ afterClosed: () => of('wrong-token') });
    const response = firstValueFrom(client.get<{ ok: boolean }>('/api/state'));
    http.expectOne('/api/state').flush('', { status: 401, statusText: 'Unauthorized' });

    await new Promise((resolve) => setTimeout(resolve));
    const firstRetry = http.expectOne('/api/state');
    expect(firstRetry.request.headers.get('Authorization')).toBe('Bearer wrong-token');
    firstRetry.flush('', { status: 401, statusText: 'Unauthorized' });

    await new Promise((resolve) => setTimeout(resolve));
    const secondRetry = http.expectOne('/api/state');
    expect(secondRetry.request.headers.get('Authorization')).toBe('Bearer test-token');
    secondRetry.flush({ ok: true });

    await expect(response).resolves.toEqual({ ok: true });
    expect(open).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('weiff.authToken')).toBe('test-token');
  });
});
