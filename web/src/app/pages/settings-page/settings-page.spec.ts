import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { RevisionDashboardState } from '../../data/revision-dashboard-state';
import { SettingsPage } from './settings-page';

describe('SettingsPage', () => {
  let fixture: ComponentFixture<SettingsPage>;
  const diffMode = signal<'inline' | 'split'>('inline');
  const themeMode = signal<'light' | 'dark' | 'system'>('system');
  const applySettings = vi.fn(
    (settings: { diffMode: 'inline' | 'split'; themeMode: 'light' | 'dark' | 'system' }) => {
      diffMode.set(settings.diffMode);
      themeMode.set(settings.themeMode);
    },
  );

  beforeEach(async () => {
    diffMode.set('inline');
    themeMode.set('system');
    applySettings.mockClear();
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        {
          provide: RevisionDashboardState,
          useValue: { diffMode, themeMode, applySettings },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
  });

  it('applies theme and diff choices immediately', () => {
    const controls = fixture.componentInstance as unknown as {
      setDiffMode(value: string): void;
      setThemeMode(value: string): void;
    };

    controls.setDiffMode('split');
    controls.setThemeMode('dark');

    expect(applySettings).toHaveBeenNthCalledWith(1, {
      diffMode: 'split',
      themeMode: 'system',
    });
    expect(applySettings).toHaveBeenNthCalledWith(2, {
      diffMode: 'split',
      themeMode: 'dark',
    });
  });
});
