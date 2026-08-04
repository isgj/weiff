import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { RepoApi } from './repo-api';

describe('RepoApi', () => {
  let service: RepoApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RepoApi);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
