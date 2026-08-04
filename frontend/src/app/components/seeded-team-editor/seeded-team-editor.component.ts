import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface SeededTeamRow {
  id: string;
  name: string;
}

@Component({
  selector: 'app-seeded-team-editor',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './seeded-team-editor.component.html',
  styleUrl: './seeded-team-editor.component.scss'
})
export class SeededTeamEditorComponent {
  @Input({ required: true }) rows: SeededTeamRow[] = [];

  @Output() rowsChange = new EventEmitter<SeededTeamRow[]>();

  addTeam(): void {
    this.emitRows([...this.rows, this.createRow()]);
  }

  insertBelow(index: number): void {
    const rows = [...this.rows];
    rows.splice(index + 1, 0, this.createRow());
    this.emitRows(rows);
  }

  remove(index: number): void {
    this.emitRows(this.rows.filter((_, rowIndex) => rowIndex !== index));
  }

  move(index: number, direction: -1 | 1): void {
    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= this.rows.length) {
      return;
    }

    const rows = [...this.rows];
    const [row] = rows.splice(index, 1);
    rows.splice(targetIndex, 0, row);
    this.emitRows(rows);
  }

  nameChanged(row: SeededTeamRow, name: string): void {
    this.emitRows(this.rows.map((candidate) => (candidate.id === row.id ? { ...candidate, name } : candidate)));
  }

  private emitRows(rows: SeededTeamRow[]): void {
    this.rowsChange.emit(rows);
  }

  private createRow(name = ''): SeededTeamRow {
    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      name
    };
  }
}
