import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable, firstValueFrom, from, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthTokenDialog } from '../components/auth-token-dialog/auth-token-dialog';

const authTokenStorageKey = 'weiff.authToken';
let tokenPrompt: Promise<string> | undefined;

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const dialog = inject(MatDialog);
  const token = localStorage.getItem(authTokenStorageKey);
  const authenticatedRequest = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authenticatedRequest).pipe(
    catchError((error: unknown) => {
      if (
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        !request.url.startsWith('/api/')
      ) {
        return throwError(() => error);
      }

      localStorage.removeItem(authTokenStorageKey);
      return retryWithToken(request, next, dialog);
    }),
  );
};

function retryWithToken(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
  dialog: MatDialog,
): Observable<HttpEvent<unknown>> {
  return from(requestToken(dialog)).pipe(
    switchMap((token) => next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }))),
    catchError((error: unknown): Observable<HttpEvent<unknown>> => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        localStorage.removeItem(authTokenStorageKey);
        return retryWithToken(request, next, dialog);
      }
      return throwError(() => error);
    }),
  );
}

function requestToken(dialog: MatDialog): Promise<string> {
  tokenPrompt ??= firstValueFrom(dialog.open(AuthTokenDialog, { disableClose: true }).afterClosed())
    .then((token) => {
      if (typeof token !== 'string' || token.trim() === '') {
        throw new Error('Authentication was cancelled.');
      }
      const value = token.trim();
      localStorage.setItem(authTokenStorageKey, value);
      return value;
    })
    .finally(() => {
      tokenPrompt = undefined;
    });
  return tokenPrompt;
}
