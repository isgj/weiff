import { httpResource } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';

interface HealthResponse {
  status: string;
}

@Component({
  selector: 'app-connection-status',
  imports: [MatTooltipModule],
  templateUrl: './connection-status.html',
  styleUrl: './connection-status.scss',
})
export class ConnectionStatus {
  readonly collapsed = input(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly health = httpResource<HealthResponse>(() => '/api/health');

  protected readonly connected = computed(
    () => this.health.hasValue() && this.health.value().status === 'ok',
  );
  protected readonly label = computed(() => {
    if (this.health.isLoading() && !this.health.hasValue()) {
      return 'Checking connection';
    }

    return this.connected() ? 'Connected: Local' : 'Disconnected';
  });
  protected readonly checking = computed(() => this.health.isLoading());

  constructor() {
    const intervalID = globalThis.setInterval(() => this.health.reload(), 5000);
    this.destroyRef.onDestroy(() => globalThis.clearInterval(intervalID));
  }
}
