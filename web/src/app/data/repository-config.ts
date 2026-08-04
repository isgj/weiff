import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { firstValueFrom } from 'rxjs';

const maximumRepositories = 20;

export interface RepositoryPreference {
  path: string;
  name?: string;
}

export interface RepositoryConfig {
  currentRepository: string;
  repositories: RepositoryPreference[];
  logRevset: string;
}

@Service()
export class RepositoryConfigStore {
  private readonly http = inject(HttpClient);
  private value = emptyRepositoryConfig();
  private serializedValue = serializeConfig(this.value);
  private loading: Promise<void> | null = null;
  private writeQueue = Promise.resolve();

  load(): Promise<void> {
    this.loading ??= this.loadOnce();
    return this.loading;
  }

  snapshot(): RepositoryConfig {
    return cloneConfig(this.value);
  }

  save(value: RepositoryConfig): void {
    const normalized = normalizeConfig(value);
    const serialized = serializeConfig(normalized);
    if (serialized === this.serializedValue) {
      return;
    }

    this.value = normalized;
    this.serializedValue = serialized;
    this.writeQueue = this.writeQueue.then(
      () => this.persist(normalized, serialized),
      () => this.persist(normalized, serialized),
    );
  }

  private async loadOnce(): Promise<void> {
    try {
      this.value = normalizeConfig(
        await firstValueFrom(this.http.get<RepositoryConfig>('/api/config')),
      );
      this.serializedValue = serializeConfig(this.value);
    } catch {
      this.value = emptyRepositoryConfig();
      this.serializedValue = serializeConfig(this.value);
    }
  }

  private async persist(value: RepositoryConfig, serialized: string): Promise<void> {
    try {
      const saved = normalizeConfig(
        await firstValueFrom(this.http.put<RepositoryConfig>('/api/config', value)),
      );
      if (this.serializedValue === serialized) {
        this.value = saved;
        this.serializedValue = serializeConfig(saved);
      }
    } catch (error) {
      if (this.serializedValue === serialized) {
        this.serializedValue = '';
      }
      console.error('Unable to save repository configuration.', error);
    }
  }
}

function normalizeConfig(value: RepositoryConfig): RepositoryConfig {
  const currentRepository = cleanString(value?.currentRepository);
  const repositories: RepositoryPreference[] = [];
  const indexes = new Map<string, number>();
  const add = (repository: RepositoryPreference): void => {
    const path = cleanString(repository?.path);
    if (path === '') {
      return;
    }

    const name = cleanString(repository?.name);
    const index = indexes.get(path);
    if (index != null) {
      if (repositories[index].name == null && name !== '') {
        repositories[index] = { path, name };
      }
      return;
    }
    if (repositories.length >= maximumRepositories) {
      return;
    }

    indexes.set(path, repositories.length);
    repositories.push(name === '' ? { path } : { path, name });
  };

  add({ path: currentRepository });
  for (const repository of Array.isArray(value?.repositories) ? value.repositories : []) {
    add(repository);
  }

  return {
    currentRepository,
    repositories,
    logRevset: cleanString(value?.logRevset),
  };
}

function emptyRepositoryConfig(): RepositoryConfig {
  return {
    currentRepository: '',
    repositories: [],
    logRevset: '',
  };
}

function cloneConfig(value: RepositoryConfig): RepositoryConfig {
  return {
    ...value,
    repositories: value.repositories.map((repository) => ({ ...repository })),
  };
}

function serializeConfig(value: RepositoryConfig): string {
  return JSON.stringify(value);
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
