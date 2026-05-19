import { Routes } from '@angular/router';
import { adminSetupGuard } from './service/admin-setup.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./routes/choose-event-page/choose-event-page.component').then(
        (module) => module.ChooseEventPageComponent
      ),
    title: 'Cheabs Live Scoring'
  },
  {
    path: 'events/:eventCode',
    title: 'Cheabs Live Scoring',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./routes/event-dashboard-page/event-dashboard-page.component').then(
            (module) => module.EventDashboardPageComponent
          )
      },
      {
        path: 'new-pool',
        canActivate: [adminSetupGuard],
        loadComponent: () =>
          import('./routes/pool-setup-page/pool-setup-page.component').then((module) => module.PoolSetupPageComponent)
      },
      {
        path: 'pools/:poolId',
        loadComponent: () => import('./routes/pool-page/pool-page.component').then((module) => module.PoolPageComponent)
      },
      {
        path: 'pools/:poolId/setup',
        canActivate: [adminSetupGuard],
        loadComponent: () =>
          import('./routes/pool-setup-page/pool-setup-page.component').then((module) => module.PoolSetupPageComponent)
      }
    ]
  },
  {
    path: '**',
    redirectTo: ''
  }
];
