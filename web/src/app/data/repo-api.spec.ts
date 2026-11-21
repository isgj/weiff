import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
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

  it('posts checkout options', () => {
    const httpMock = TestBed.inject(HttpTestingController);
    service
      .checkout('abc', '/tmp/repo', {
        ignoreImmutable: true,
        ignoreWorkingCopy: false,
        noIntegrateOperation: true,
      })
      .subscribe();

    const request = httpMock.expectOne('/api/checkout');
    expect(request.request.body).toEqual({
      rev: 'abc',
      repoPath: '/tmp/repo',
      ignoreImmutable: true,
      ignoreWorkingCopy: false,
      noIntegrateOperation: true,
    });
    request.flush({});
    httpMock.verify();
  });
});
