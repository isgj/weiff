import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RepositoryConfigStore } from './repository-config';

describe('RepositoryConfigStore', () => {
  let http: HttpTestingController;
  let store: RepositoryConfigStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RepositoryConfigStore);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('loads repository configuration from the backend', async () => {
    const loading = store.load();
    http.expectOne('/api/config').flush({
      currentRepository: '/tmp/current',
      repositories: [{ path: '/tmp/current', name: 'Main' }, { path: '/tmp/other' }],
      logRevset: 'description(feat)',
    });
    await loading;

    expect(store.snapshot()).toEqual({
      currentRepository: '/tmp/current',
      repositories: [{ path: '/tmp/current', name: 'Main' }, { path: '/tmp/other' }],
      logRevset: 'description(feat)',
    });
  });

  it('queues repository configuration writes in order', async () => {
    const loading = store.load();
    http.expectOne('/api/config').flush({
      currentRepository: '',
      repositories: [],
      logRevset: '',
    });
    await loading;

    store.save({
      currentRepository: '/tmp/first',
      repositories: [{ path: '/tmp/first' }],
      logRevset: '',
    });
    store.save({
      currentRepository: '/tmp/second',
      repositories: [{ path: '/tmp/second' }],
      logRevset: 'mine()',
    });
    await Promise.resolve();

    const first = http.expectOne('/api/config');
    expect(first.request.body.currentRepository).toBe('/tmp/first');
    first.flush(first.request.body);
    await new Promise((resolve) => setTimeout(resolve));

    const second = http.expectOne('/api/config');
    expect(second.request.body.currentRepository).toBe('/tmp/second');
    expect(second.request.body.logRevset).toBe('mine()');
    second.flush(second.request.body);
    await Promise.resolve();
  });
});
