import { Component, inject } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { normalizeThemeMode } from '../../core/theme.service';
import { RevisionDashboardState } from '../../data/revision-dashboard-state';

@Component({
  selector: 'app-settings-page',
  imports: [MatButtonToggleModule, MatIconModule],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  protected readonly dashboard = inject(RevisionDashboardState);

  protected setDiffMode(value: string): void {
    this.dashboard.applySettings({
      diffMode: value === 'split' ? 'split' : 'inline',
      themeMode: this.dashboard.themeMode(),
    });
  }

  protected setThemeMode(value: string): void {
    this.dashboard.applySettings({
      diffMode: this.dashboard.diffMode(),
      themeMode: normalizeThemeMode(value),
    });
  }
}
