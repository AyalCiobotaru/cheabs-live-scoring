import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface DivisionFilterOption {
  category: string;
  division: string;
  count: number;
}

export interface CategoryFilterOption {
  category: string;
  divisions: DivisionFilterOption[];
  cards: unknown[];
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
  @Input() selectedCategory: string | null = null;
  @Input() selectedDivision: string | null = null;
  @Input() showingFavoritePools = false;
  @Input() divisionOptions: CategoryFilterOption[] = [];

  @Output() poolsSelected = new EventEmitter<void>();
  @Output() favoritesSelected = new EventEmitter<void>();
  @Output() playoffsSelected = new EventEmitter<void>();
  @Output() divisionPlayoffsSelected = new EventEmitter<{ category: string; division: string }>();
  @Output() chooseEventSelected = new EventEmitter<void>();
  @Output() adminSelected = new EventEmitter<void>();
  @Output() adminSignOutSelected = new EventEmitter<void>();
  @Output() divisionSelected = new EventEmitter<{ category: string; division: string | null } | null>();

  menuOpen = false;
  collapsedCategories = new Set<string>();
  expandedDivisions = new Set<string>();

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  selectPools(): void {
    this.poolsSelected.emit();
    this.closeMenu();
  }

  selectFavorites(): void {
    this.favoritesSelected.emit();
    this.closeMenu();
  }

  selectPlayoffs(): void {
    this.playoffsSelected.emit();
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

  selectDivision(category: string, division: string | null): void {
    this.divisionSelected.emit({ category, division });
    this.closeMenu();
  }

  toggleCategory(category: string): void {
    const next = new Set(this.collapsedCategories);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    this.collapsedCategories = next;
  }

  toggleDivision(category: string, division: string): void {
    const key = `${category}:${division}`;
    const next = new Set(this.expandedDivisions);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.expandedDivisions = next;
  }

  selectDivisionPlayoffs(category: string, division: string): void {
    this.divisionPlayoffsSelected.emit({ category, division });
    this.closeMenu();
  }
}
