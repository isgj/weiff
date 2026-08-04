import { ThemeMode } from './theme.service';
import { DiffMode } from '../components/diff-view/diff-view';

export interface AppSettings {
  diffMode: DiffMode;
  themeMode: ThemeMode;
}
