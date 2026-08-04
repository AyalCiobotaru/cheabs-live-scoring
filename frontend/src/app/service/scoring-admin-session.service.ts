import { Injectable } from '@angular/core';
import { ScoringEventApiService } from './scoring-event-api.service';
import { ScoringEventStorageService } from './scoring-event-storage.service';

@Injectable({ providedIn: 'root' })
export class ScoringAdminSessionService {
  constructor(
    private readonly api: ScoringEventApiService,
    private readonly storage: ScoringEventStorageService
  ) {}

  currentPassword(): string {
    return this.storage.adminPassword();
  }

  async signIn(adminPassword: string): Promise<void> {
    await this.api.adminLogin(adminPassword);
    this.storage.saveAdminPassword(adminPassword);
  }

  signOut(): void {
    this.storage.clearAdminPassword();
  }
}
