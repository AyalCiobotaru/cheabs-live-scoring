import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface DivisionFilterOption {
  division: string;
  count: number;
}

@Component({
  selector: 'app-side-menu',
  standalone: true,
  templateUrl: './side-menu.component.html',
  styleUrl: './side-menu.component.scss'
})
export class SideMenuComponent {
  @Input() hasEvent = false;
  @Input() isAdmin = false;
  @Input() poolCount = 0;
  @Input() favoritePoolCount = 0;
  @Input() selectedDivision: string | null = null;
  @Input() showingFavoritePools = false;
  @Input() divisionOptions: DivisionFilterOption[] = [];

  @Output() poolsSelected = new EventEmitter<void>();
  @Output() favoritesSelected = new EventEmitter<void>();
  @Output() chooseEventSelected = new EventEmitter<void>();
  @Output() adminSelected = new EventEmitter<void>();
  @Output() adminSignOutSelected = new EventEmitter<void>();
  @Output() divisionSelected = new EventEmitter<string | null>();

  menuOpen = false;
  divisionsExpanded = false;

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  toggleDivisions(): void {
    this.divisionsExpanded = !this.divisionsExpanded;
  }

  selectPools(): void {
    this.poolsSelected.emit();
    this.closeMenu();
  }

  selectFavorites(): void {
    this.favoritesSelected.emit();
    this.closeMenu();
  }

  selectChooseEvent(): void {
    this.chooseEventSelected.emit();
    this.closeMenu();
  }

  selectAdmin(): void {
    this.adminSelected.emit();
    this.closeMenu();
  }

  selectAdminSignOut(): void {
    this.adminSignOutSelected.emit();
    this.closeMenu();
  }

  selectDivision(division: string | null): void {
    this.divisionSelected.emit(division);
    this.closeMenu();
  }
}
