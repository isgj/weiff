import { provideHttpClient } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { RepositoryConfigStore } from './data/repository-config';
import { routes } from './routes';

const dialogDefaults: MatDialogConfig = {
  ...new MatDialogConfig(),
  width: 'min(520px, calc(100vw - 32px))',
  maxWidth: 'calc(100vw - 32px)',
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideAppInitializer(() => inject(RepositoryConfigStore).load()),
    provideRouter(routes),
    { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: dialogDefaults },
  ],
};
