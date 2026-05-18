import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/outdoor-scoring/outdoor-scoring-page.component')
      .then((module) => module.OutdoorScoringPageComponent),
    title: 'Cheabs Live Scoring'
  },
  {
    path: 'outdoor-scoring',
    redirectTo: '',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: ''
  }
];
