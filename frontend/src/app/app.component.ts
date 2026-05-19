import { AsyncPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewEncapsulation, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { SideMenuComponent } from './components/side-menu/side-menu.component';
import { ScoringEventStateService } from './service/scoring-event-state.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, FormsModule, RouterOutlet, SideMenuComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  encapsulation: ViewEncapsulation.None
})
export class AppComponent implements OnInit, OnDestroy {
  readonly scoring = inject(ScoringEventStateService);
  private readonly router = inject(Router);
  private routeSubscription?: Subscription;

  ngOnInit(): void {
    this.scoring.init();
    this.routeSubscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        void this.loadEventFromRoute();
      });
    void this.loadEventFromRoute();
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.scoring.destroy();
  }

  private async loadEventFromRoute(): Promise<void> {
    const eventCode = this.findEventCode();

    if (eventCode) {
      await this.scoring.loadEvent(eventCode);
    }
  }

  private findEventCode(): string | null {
    let route = this.router.routerState.snapshot.root;

    while (route.firstChild) {
      route = route.firstChild;
      const eventCode = route.paramMap.get('eventCode');

      if (eventCode) {
        return eventCode;
      }
    }

    return null;
  }
}
