import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ConnectionStatus } from './connection-status';

@Component({
  imports: [ConnectionStatus],
  template: '<app-connection-status [collapsed]="collapsed" />',
})
class HostComponent {
  collapsed = false;
}

describe('ConnectionStatus', () => {
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    vi.useFakeTimers();

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.useRealTimers();
  });

  it('should show the connected state from the health endpoint', async () => {
    fixture.detectChanges();

    http.expectOne('/api/health').flush({ status: 'ok' });
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Connected: Local');
    expect(fixture.nativeElement.querySelector('.is-connected')).toBeTruthy();
  });

  it('should hide text in collapsed mode', async () => {
    fixture.componentInstance.collapsed = true;
    fixture.detectChanges();

    http.expectOne('/api/health').flush({ status: 'ok' });
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Connected: Local');
  });

  it('should refresh the health status every five seconds', async () => {
    fixture.detectChanges();

    http.expectOne('/api/health').flush({ status: 'ok' });
    await Promise.resolve();
    fixture.detectChanges();

    vi.advanceTimersByTime(5000);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Connected: Local');
    expect(fixture.nativeElement.textContent).not.toContain('Checking connection');
    http.expectOne('/api/health').flush({ status: 'ok' });
  });
});
