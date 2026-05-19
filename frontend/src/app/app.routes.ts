import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./scoring/scoring-page.component')
      .then((module) => module.ScoringPageComponent),
    title: 'Cheabs Live Scoring'
  },
  {
    path: '**',
    redirectTo: ''
  }
];
