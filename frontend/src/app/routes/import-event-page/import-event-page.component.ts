import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CsvImportIssue, CsvImportPreview, CsvImportRow, Match } from '../../models';
import { ScoringEventStateService } from '../../service/scoring-event-state.service';
import { csvImportTemplate, parseCsvImportFile } from '../../util/csv-event-import-rules';

@Component({
  selector: 'app-import-event-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './import-event-page.component.html',
  styleUrl: './import-event-page.component.scss'
})
export class ImportEventPageComponent {
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  readonly scoring = inject(ScoringEventStateService);

  readonly showingStructuredTemplate = signal(false);
  readonly preview = signal<CsvImportPreview | null>(null);
  readonly loading = signal(false);
  readonly readingFile = signal(false);
  readonly selectedFileName = signal('');
  readonly fileError = signal('');
  readonly serverRejected = signal(false);
  structuredEventCode = '';
  structuredEventTitle = '';
  structuredPoolCounts: Record<number, number> = {
    3: 0,
    4: 0,
    5: 0,
    6: 0,
    7: 0
  };
  readonly canImport = computed(() => {
    const preview = this.preview();
    return Boolean(preview && preview.errors.length === 0 && !this.loading() && !this.serverRejected());
  });
  readonly importDisabledReason = computed(() => {
    const preview = this.preview();

    if (this.loading()) {
      return '';
    }

    if (!preview) {
      return 'Choose a CSV file to preview before importing.';
    }

    if (this.serverRejected()) {
      return 'Server validation rejected this import. Reselect the CSV file after fixing it.';
    }

    if (preview.errors.length > 0) {
      return `Fix ${preview.errors.length} blocking error${preview.errors.length === 1 ? '' : 's'} before importing.`;
    }

    return '';
  });

  async chooseFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    this.fileError.set('');
    this.selectedFileName.set(file?.name ?? '');
    this.serverRejected.set(false);
    this.preview.set(null);

    if (!file) {
      return;
    }

    this.readingFile.set(true);

    try {
      const text = await file.text();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      this.preview.set(parseCsvImportFile(file.name, text));
    } catch {
      this.fileError.set('Unable to read that CSV file.');
    } finally {
      this.readingFile.set(false);
    }
  }

  downloadTemplate(): void {
    this.downloadCsv(csvImportTemplate(), 'event-import-template.csv');
  }

  openStructuredTemplate(): void {
    this.structuredEventCode = this.scoring.eventCode || '';
    this.structuredEventTitle = this.scoring.eventName || '';
    this.structuredPoolCounts = {
      3: 0,
      4: 0,
      5: 0,
      6: 0,
      7: 0
    };
    this.showingStructuredTemplate.set(true);
  }

  closeStructuredTemplate(): void {
    this.showingStructuredTemplate.set(false);
  }

  downloadStructuredTemplate(): void {
    const rows = [
      [
        'event_code',
        'event_name',
        'pool_key',
        'pool_title',
        'pool_order',
        'division',
        'team_count',
        'games_per_match',
        'target_score',
        'point_cap',
        'schedule_preset',
        'seed',
        'team_name'
      ]
    ];
    let poolOrder = 1;

    for (const teamCount of [3, 4, 5, 6, 7]) {
      const poolCount = this.wholeNumber(this.structuredPoolCounts[teamCount]);

      for (let poolIndex = 1; poolIndex <= poolCount; poolIndex += 1) {
        const poolKey = `${teamCount}-team-pool-${poolIndex}`;
        const poolTitle = `${teamCount} Team Pool ${poolIndex}`;

        for (let seed = 1; seed <= teamCount; seed += 1) {
          rows.push([
            this.structuredEventCode.trim(),
            this.structuredEventTitle.trim(),
            poolKey,
            poolTitle,
            String(poolOrder),
            'Open',
            String(teamCount),
            '',
            '',
            '',
            '',
            String(seed),
            ''
          ]);
        }

        poolOrder += 1;
      }
    }

    this.downloadCsv(rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n', 'event-import-structured-template.csv');
    this.closeStructuredTemplate();
  }

  structuredTemplateReady(): boolean {
    return (
      Boolean(this.structuredEventCode.trim()) &&
      Boolean(this.structuredEventTitle.trim()) &&
      [3, 4, 5, 6, 7].some((teamCount) => this.wholeNumber(this.structuredPoolCounts[teamCount]) > 0)
    );
  }

  private downloadCsv(content: string, fileName: string): void {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async importEvent(): Promise<void> {
    const preview = this.preview();

    if (!preview || !this.canImport()) {
      return;
    }

    this.loading.set(true);

    try {
      const result = await this.scoring.importEvent(preview.fileName, this.rowsForImport(preview.rows));

      if (result.errors?.length) {
        this.preview.set({
          ...preview,
          errors: result.errors,
          warnings: result.warnings ?? preview.warnings
        });
        this.serverRejected.set(true);
        this.clearSelectedFile();
      }
    } finally {
      this.loading.set(false);
    }
  }

  issueLabel(issue: CsvImportIssue): string {
    return issue.lineNumber == null ? issue.message : `Row ${issue.lineNumber}: ${issue.message}`;
  }

  matchLabel(match: Match): string {
    return `${this.seedLabel(match.teamASeed)} vs ${this.seedLabel(match.teamBSeed)}, ref ${this.seedLabel(match.refSeed)}`;
  }

  private seedLabel(seed: number | null): string {
    return seed == null ? 'TBD' : `Seed ${seed}`;
  }

  private rowsForImport(rows: CsvImportRow[]): CsvImportRow[] {
    return rows.map((row) => ({
      lineNumber: row.lineNumber,
      values: { ...row.values }
    }));
  }

  private clearSelectedFile(): void {
    const input = this.fileInput?.nativeElement;

    if (input) {
      input.value = '';
    }
  }

  private wholeNumber(value: number): number {
    return Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  }
}

const csvCell = (value: string): string => {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
};
