import { TestBed } from '@angular/core/testing';

import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset['theme'];
    TestBed.configureTestingModule({});
  });

  it('uses the system color scheme by default', () => {
    const service = TestBed.inject(ThemeService);

    expect(service.mode()).toBe('system');
    expect(document.documentElement.dataset['theme']).toBe('system');
  });

  it('applies and persists a selected theme mode', () => {
    const service = TestBed.inject(ThemeService);

    service.setMode('light');

    expect(service.mode()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(window.localStorage.getItem('weiff.theme')).toBe('light');
  });
});
