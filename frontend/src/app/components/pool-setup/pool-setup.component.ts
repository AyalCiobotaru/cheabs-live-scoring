import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  inject,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { readSheet } from 'read-excel-file/browser';
import { PoolState, ScanSummary, SeededImportFormats, SeededImportPreview } from '../../models';
import { assignCourtNumbersToMatches, courtNumbersText, parseCourtNumbers } from '../../util/pool-setup-rules';
import { SchedulePreset } from '../../util/schedule-presets';
import { DEFAULT_SEEDED_IMPORT_FORMATS, buildSeededImportPreview } from '../../util/seeded-pool-import-rules';

interface SeededTeamRow {
  id: string;
  name: string;
}

@Component({
  selector: 'app-pool-setup',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './pool-setup.component.html'
})
export class PoolSetupComponent implements OnChanges {
  private readonly changeDetector = inject(ChangeDetectorRef);

  @Input({ required: true }) pool!: PoolState;
  @Input({ required: true }) isAdmin = false;
  @Input({ required: true }) teamCountOptions: number[] = [];
  @Input({ required: true }) categoryOptions: string[] = [];
  @Input({ required: true }) divisionOptions: string[] = [];
  @Input({ required: true }) schedulePresets: SchedulePreset[] = [];
  @Input({ required: true }) existingDivisionPoolCount = 0;
  @Input({ required: true }) seededImportEnabled = true;
  @Input({ required: true }) scanStatus: 'idle' | 'scanning' | 'success' | 'failed' = 'idle';
  @Input() scanProgress = '';
  @Input() scanSummary: ScanSummary | null = null;
  @Input() scanError = '';
  @Input() canDeletePool = false;

  @Output() sheetCaptured = new EventEmitter<Event>();
  @Output() sheetScanned = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() teamCountChanged = new EventEmitter<number>();
  @Output() gameFormatApplied = new EventEmitter<void>();
  @Output() poolSetupSaved = new EventEmitter<void>();
  @Output() poolDeleted = new EventEmitter<void>();
  @Output() setupCanceled = new EventEmitter<void>();
  @Output() seededPoolsCreated = new EventEmitter<{
    pools: PoolState[];
    category: string;
    division: string;
    replaceDivisionPools: boolean;
  }>();
  @Output() matchAdded = new EventEmitter<void>();
  @Output() matchMoved = new EventEmitter<{ matchId: string; direction: -1 | 1 }>();
  @Output() matchRemoved = new EventEmitter<string>();
  @Output() schedulePresetApplied = new EventEmitter<string>();

  selectedSchedulePresetId = '';
  setupMode: 'manual' | 'seeded' = 'manual';
  replaceDivisionPools = false;
  prioritizeFiveTeamPools = false;
  seededImportText = '';
  seededImportFileName = '';
  seededImportError = '';
  seededImportReading = false;
  seededTeamRows: SeededTeamRow[] = [];
  seededImportPreview: SeededImportPreview | null = null;
  seededFormats: SeededImportFormats = structuredClone(DEFAULT_SEEDED_IMPORT_FORMATS);
  courtNumbersTextValue = '';
  manualCourtError = '';
  activeTooltipId = '';
  private initializedSeededSourceKey = '';

  get seededFormatRows(): { size: 4 | 5 | 6 | 7; format: SeededImportFormats[4] }[] {
    return [
      { size: 4, format: this.seededFormats[4] },
      { size: 5, format: this.seededFormats[5] },
      { size: 6, format: this.seededFormats[6] },
      { size: 7, format: this.seededFormats[7] }
    ];
  }

  get primarySeededFormatRows(): { size: 4 | 5; format: SeededImportFormats[4] }[] {
    return [
      { size: 4, format: this.seededFormats[4] },
      { size: 5, format: this.seededFormats[5] }
    ];
  }

  get advancedSeededFormatRows(): { size: 6 | 7; format: SeededImportFormats[6] }[] {
    return [
      { size: 6, format: this.seededFormats[6] },
      { size: 7, format: this.seededFormats[7] }
    ];
  }

  get manualSchedulePresets(): SchedulePreset[] {
    return this.schedulePresetsForSize(this.pool.teamCount);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.seededImportEnabled && this.setupMode === 'seeded') {
      this.setupMode = 'manual';
    }

    if (changes['pool']) {
      this.courtNumbersTextValue = this.courtNumbersInput();
      this.validateManualCourtNumbers();
      this.initializeSeededSourceUpdate();
    }

    if (changes['pool'] || changes['existingDivisionPoolCount']) {
      this.refreshSeededPreview();
    }
  }

  setSetupMode(mode: 'manual' | 'seeded'): void {
    if (mode === 'seeded' && !this.seededImportEnabled) {
      return;
    }

    this.setupMode = mode;
    this.activeTooltipId = '';
    this.defaultSeededSchedulePresets();
    this.validateManualCourtNumbers();
    this.refreshSeededPreview();
  }

  teamCountSelected(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.teamCountChanged.emit(Number(select.value));
    select.value = String(this.pool.teamCount);
  }

  schedulePresetSelected(presetId: string): void {
    this.selectedSchedulePresetId = presetId;

    if (this.selectedSchedulePresetIsAvailable()) {
      this.schedulePresetApplied.emit(presetId);
    }
  }

  selectedSchedulePresetIsAvailable(): boolean {
    return this.manualSchedulePresets.some((preset) => preset.id === this.selectedSchedulePresetId);
  }

  seededSourceUpdateMode(): boolean {
    return this.setupMode === 'seeded' && Boolean(this.pool.seededPoolSource);
  }

  async seededFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    this.seededImportError = '';
    this.seededImportText = '';
    this.seededImportFileName = file?.name ?? '';
    this.seededImportReading = false;
    this.seededTeamRows = [];
    this.seededImportPreview = null;

    if (!file) {
      return;
    }

    try {
      this.seededImportReading = true;
      this.changeDetector.detectChanges();
      this.seededImportText = await readSeededTeamFile(file);
      const preview = this.seededPreviewForText(this.seededImportText);
      this.seededTeamRows = this.seededRowsFromPreview(preview);

      if (this.seededTeamRows.length) {
        this.refreshSeededPreview();
      } else {
        this.seededImportPreview = preview;
      }
    } catch (error) {
      this.seededImportError = error instanceof Error ? error.message : 'Unable to read that seeded team file.';
    } finally {
      this.seededImportReading = false;
      this.changeDetector.detectChanges();
    }
  }

  refreshSeededPreview(): void {
    this.defaultSeededSchedulePresets();
    this.syncSeededImportTextFromRows();

    if (!this.seededImportText.trim() || !this.pool) {
      this.seededImportPreview = null;
      return;
    }

    this.seededImportPreview = buildSeededImportPreview(
      this.seededImportText,
      this.pool.category,
      this.pool.division,
      this.seededFormats,
      this.replaceDivisionPools ? 1 : this.existingDivisionPoolCount + 1,
      this.pool.matchStartTimerMinutes,
      this.pool.courtNumbers ?? [],
      this.pool.hidden,
      this.pool.editable ?? true,
      this.prioritizeFiveTeamPools
    );
  }

  createSeededPools(): void {
    const preview = this.seededImportPreview;

    if (!preview || preview.errors.length > 0) {
      return;
    }

    this.seededPoolsCreated.emit({
      pools: preview.pools,
      category: this.pool.category,
      division: this.pool.division,
      replaceDivisionPools: this.replaceDivisionPools || Boolean(this.pool.seededPoolSource)
    });
  }

  seededSubmitLabel(): string {
    return this.seededSourceUpdateMode() ? 'Update Pools' : 'Create Pools';
  }

  seededTeamRowsChanged(): void {
    this.refreshSeededPreview();
  }

  addSeededTeam(): void {
    this.seededTeamRows = [...this.seededTeamRows, this.createSeededTeamRow()];
    this.refreshSeededPreview();
  }

  insertSeededTeamBelow(index: number): void {
    const rows = [...this.seededTeamRows];
    rows.splice(index + 1, 0, this.createSeededTeamRow());
    this.seededTeamRows = rows;
    this.refreshSeededPreview();
  }

  removeSeededTeam(index: number): void {
    this.seededTeamRows = this.seededTeamRows.filter((_, rowIndex) => rowIndex !== index);
    this.refreshSeededPreview();
  }

  moveSeededTeam(index: number, direction: -1 | 1): void {
    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= this.seededTeamRows.length) {
      return;
    }

    const rows = [...this.seededTeamRows];
    const [row] = rows.splice(index, 1);
    rows.splice(targetIndex, 0, row);
    this.seededTeamRows = rows;
    this.refreshSeededPreview();
  }

  seededPoolSummary(pool: PoolState): string {
    return `${pool.teamCount} teams, ${pool.gamesPerMatch} game${pool.gamesPerMatch === 1 ? '' : 's'} to ${
      pool.targetScore
    }, ${pool.pointCap === null ? 'no cap' : `cap ${pool.pointCap}`}, ${this.seededTimerSummary(pool)}, ${this.courtSummary(
      pool
    )}, ${pool.editable ? 'scoring open' : 'scoring locked'}, ${pool.hidden ? 'hidden' : 'visible'}`;
  }

  courtNumbersInput(): string {
    return courtNumbersText(this.pool.courtNumbers ?? []);
  }

  courtSummary(pool: PoolState): string {
    const courtNumbers = pool.courtNumbers ?? [];

    return courtNumbers.length
      ? `court${courtNumbers.length === 1 ? '' : 's'} ${courtNumbers.join(', ')}`
      : 'no courts';
  }

  courtNumbersChanged(value: string): void {
    this.courtNumbersTextValue = value;
    const courtNumbers = parseCourtNumbers(value);

    if (this.setupMode === 'manual' && courtNumbers.length !== 1) {
      this.manualCourtError = 'Manual pools must use exactly one court.';
      return;
    }

    this.manualCourtError = '';
    this.pool.courtNumbers = courtNumbers;
    this.pool.matches = assignCourtNumbersToMatches(this.pool.matches, courtNumbers);
    this.saved.emit();
    this.refreshSeededPreview();
  }

  toggleTooltip(event: Event, tooltipId: string): void {
    event.stopPropagation();
    this.activeTooltipId = this.activeTooltipId === tooltipId ? '' : tooltipId;
  }

  @HostListener('document:click')
  closeTooltip(): void {
    this.activeTooltipId = '';
  }

  seededTimerSummary(pool: PoolState): string {
    return pool.matchStartTimerMinutes > 0 ? `${pool.matchStartTimerMinutes} min between matches` : 'match timer off';
  }

  schedulePresetsForSize(size: number): SchedulePreset[] {
    return this.schedulePresets.filter((preset) => preset.teamCount === size);
  }

  private defaultSeededSchedulePresets(): void {
    for (const row of this.seededFormatRows) {
      if (!row.format.schedulePresetId) {
        row.format.schedulePresetId = this.schedulePresetsForSize(row.size)[0]?.id ?? '';
      }
    }
  }

  private validateManualCourtNumbers(): void {
    if (this.setupMode !== 'manual') {
      this.manualCourtError = '';
      return;
    }

    const courtNumbers = parseCourtNumbers(this.courtNumbersTextValue);
    this.manualCourtError = courtNumbers.length === 1 ? '' : 'Manual pools must use exactly one court.';
  }

  private initializeSeededSourceUpdate(): void {
    const source = this.pool?.seededPoolSource;
    const sourceKey = source ? `${source.category}:${source.division}:${source.updatedAt}:${source.teams.length}` : '';

    if (!source || this.initializedSeededSourceKey === sourceKey) {
      return;
    }

    this.initializedSeededSourceKey = sourceKey;
    this.setupMode = 'seeded';
    this.replaceDivisionPools = true;
    this.prioritizeFiveTeamPools = source.prioritizeFiveTeamPools;
    this.seededTeamRows = source.teams
      .slice()
      .sort((left, right) => left.seed - right.seed)
      .map((team) => this.createSeededTeamRow(team.name));
    this.syncSeededImportTextFromRows();

    for (const size of [4, 5, 6, 7] as const) {
      const format = source.formats[String(size)];

      if (format) {
        this.seededFormats[size] = { ...format };
      }
    }
  }

  private syncSeededImportTextFromRows(): void {
    this.seededImportText = this.seededTeamRows
      .map((row, index) => `${index + 1},${csvCell(row.name)}`)
      .join('\n');
  }

  private seededPreviewForText(fileText: string): SeededImportPreview {
    return buildSeededImportPreview(
      fileText,
      this.pool.category,
      this.pool.division,
      this.seededFormats,
      1,
      this.pool.matchStartTimerMinutes,
      this.pool.courtNumbers ?? [],
      this.pool.hidden,
      this.pool.editable ?? true,
      this.prioritizeFiveTeamPools
    );
  }

  private seededRowsFromPreview(preview: SeededImportPreview): SeededTeamRow[] {
    return preview.teams
      .slice()
      .sort((left, right) => left.seed - right.seed)
      .map((team) => this.createSeededTeamRow(team.name));
  }

  private createSeededTeamRow(name = ''): SeededTeamRow {
    return {
      id: createRowId(),
      name
    };
  }

  scheduleTooltip(size: number, presetId: string): string {
    const preset =
      this.schedulePresets.find((candidate) => candidate.id === presetId) ?? this.schedulePresetsForSize(size)[0];

    if (!preset) {
      return 'No schedule preset is available for that pool size.';
    }

    return preset.rows.map((row) => `${row.teamASeed} vs ${row.teamBSeed}, work ${row.refSeed}`).join('\n');
  }
}

const readSeededTeamFile = async (file: File): Promise<string> => {
  if (isExcelFile(file)) {
    return worksheetToSeededCsv(await readSheet(file));
  }

  if (isLegacyExcelFile(file)) {
    throw new Error('Legacy .xls files are not supported. Save the spreadsheet as .xlsx or CSV and try again.');
  }

  return file.text();
};

const worksheetToSeededCsv = (rows: unknown[][]): string =>
  rows
    .map((row) => [excelCellText(row[0]), excelCellText(row[1])])
    .filter(([seed, teamName]) => seed || teamName)
    .map(([seed, teamName]) => [csvCell(seed), csvCell(teamName)].join(','))
    .join('\n');

const csvCell = (value: string): string => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

const createRowId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const excelCellText = (value: unknown): string => {
  if (value == null) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value).trim();
};

const isExcelFile = (file: File): boolean => {
  const fileName = file.name.toLowerCase();

  return (
    fileName.endsWith('.xlsx') || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
};

const isLegacyExcelFile = (file: File): boolean =>
  file.name.toLowerCase().endsWith('.xls') || file.type === 'application/vnd.ms-excel';
