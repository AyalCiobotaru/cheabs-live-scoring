export interface ScheduleTemplateRow {
  teamASeed: number;
  teamBSeed: number;
  refSeed: number;
}


export interface SchedulePreset {
  id: string;
  label: string;
  teamCount: number;
  rows: ScheduleTemplateRow[];
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  {
    id: '3-team-standard',
    label: '3 Team Standard',
    teamCount: 3,
    rows: [
      { teamASeed: 1, teamBSeed: 2, refSeed: 3 },
      { teamASeed: 2, teamBSeed: 3, refSeed: 1 },
      { teamASeed: 1, teamBSeed: 3, refSeed: 2 },
      { teamASeed: 1, teamBSeed: 2, refSeed: 3 },
      { teamASeed: 2, teamBSeed: 3, refSeed: 1 },
      { teamASeed: 1, teamBSeed: 3, refSeed: 2 }
    ]
  },
  {
    id: '4-team-standard',
    label: '4 Team Standard',
    teamCount: 4,
    rows: [
      { teamASeed: 2, teamBSeed: 4, refSeed: 1 },
      { teamASeed: 1, teamBSeed: 3, refSeed: 2 },
      { teamASeed: 1, teamBSeed: 4, refSeed: 3 },
      { teamASeed: 2, teamBSeed: 3, refSeed: 1 },
      { teamASeed: 3, teamBSeed: 4, refSeed: 2 },
      { teamASeed: 1, teamBSeed: 2, refSeed: 4 }
    ]

  },
  {
    id: '4-team-alt-1',
    label: '4 Team Alt 1 (ECV)',
    teamCount: 4,
    rows: [
      { teamASeed: 2, teamBSeed: 3, refSeed: 4 },
      { teamASeed: 1, teamBSeed: 4, refSeed: 3 },
      { teamASeed: 2, teamBSeed: 4, refSeed: 1 },
      { teamASeed: 1, teamBSeed: 3, refSeed: 4 },
      { teamASeed: 3, teamBSeed: 4, refSeed: 2 },
      { teamASeed: 1, teamBSeed: 2, refSeed: 3 }
    ]
    
  },
  {
    id: '5-team-standard',
    label: '5 Team Standard',
    teamCount: 5,
    rows: [
      { teamASeed: 2, teamBSeed: 5, refSeed: 3 },
      { teamASeed: 1, teamBSeed: 4, refSeed: 2 },
      { teamASeed: 3, teamBSeed: 5, refSeed: 1 },
      { teamASeed: 2, teamBSeed: 4, refSeed: 5 },
      { teamASeed: 1, teamBSeed: 3, refSeed: 4 },
      { teamASeed: 4, teamBSeed: 5, refSeed: 1 },
      { teamASeed: 2, teamBSeed: 3, refSeed: 4 },
      { teamASeed: 1, teamBSeed: 5, refSeed: 2 },
      { teamASeed: 3, teamBSeed: 4, refSeed: 5 },
      { teamASeed: 1, teamBSeed: 2, refSeed: 3 }
    ]
  },
  {
    id: '6-team-standard',
    label: '6 Team Standard',
    teamCount: 6,
    rows: [
      { teamASeed: 3, teamBSeed: 5, refSeed: 1 },
      { teamASeed: 4, teamBSeed: 6, refSeed: 2 },
      { teamASeed: 1, teamBSeed: 5, refSeed: 3 },
      { teamASeed: 2, teamBSeed: 6, refSeed: 4 },
      { teamASeed: 1, teamBSeed: 3, refSeed: 5 },
      { teamASeed: 2, teamBSeed: 4, refSeed: 6 },
      { teamASeed: 3, teamBSeed: 6, refSeed: 1 },
      { teamASeed: 4, teamBSeed: 5, refSeed: 2 },
      { teamASeed: 1, teamBSeed: 6, refSeed: 4 },
      { teamASeed: 2, teamBSeed: 5, refSeed: 3 },
      { teamASeed: 1, teamBSeed: 4, refSeed: 6 },
      { teamASeed: 2, teamBSeed: 3, refSeed: 5 },
      { teamASeed: 3, teamBSeed: 4, refSeed: 1 },
      { teamASeed: 5, teamBSeed: 6, refSeed: 2 },
      { teamASeed: 1, teamBSeed: 2, refSeed: 3 }
    ]
  },
  {
    id: '6-team-alt-1',
    label: '6 Team Alt 1 (ECV)',
    teamCount: 6,
    rows: [
      { teamASeed: 1, teamBSeed: 2, refSeed: 5 },
      { teamASeed: 3, teamBSeed: 4, refSeed: 6 },
      { teamASeed: 5, teamBSeed: 6, refSeed: 2 },
      { teamASeed: 1, teamBSeed: 3, refSeed: 4 },
      { teamASeed: 5, teamBSeed: 4, refSeed: 1 },
      { teamASeed: 2, teamBSeed: 6, refSeed: 3 },
      { teamASeed: 1, teamBSeed: 4, refSeed: 5 },
      { teamASeed: 2, teamBSeed: 3, refSeed: 6 },
      { teamASeed: 5, teamBSeed: 1, refSeed: 4 },
      { teamASeed: 6, teamBSeed: 3, refSeed: 2 },
      { teamASeed: 5, teamBSeed: 2, refSeed: 1 },
      { teamASeed: 6, teamBSeed: 4, refSeed: 3 },
      { teamASeed: 5, teamBSeed: 3, refSeed: 1 },
      { teamASeed: 2, teamBSeed: 4, refSeed: 6 },
      { teamASeed: 1, teamBSeed: 6, refSeed: 3 }
    ]
  },
  {
    id: '7-team-standard',
    label: '7 Team Standard',
    teamCount: 7,
    rows: [
      { teamASeed: 2, teamBSeed: 7, refSeed: 1 },
      { teamASeed: 3, teamBSeed: 5, refSeed: 4 },
      { teamASeed: 1, teamBSeed: 7, refSeed: 2 },
      { teamASeed: 4, teamBSeed: 6, refSeed: 3 },
      { teamASeed: 2, teamBSeed: 5, refSeed: 1 },
      { teamASeed: 3, teamBSeed: 6, refSeed: 7 },
      { teamASeed: 1, teamBSeed: 4, refSeed: 5 },
      { teamASeed: 3, teamBSeed: 7, refSeed: 6 },
      { teamASeed: 1, teamBSeed: 5, refSeed: 4 },
      { teamASeed: 2, teamBSeed: 6, refSeed: 3 },
      { teamASeed: 4, teamBSeed: 5, refSeed: 7 },
      { teamASeed: 6, teamBSeed: 7, refSeed: 5 },
      { teamASeed: 1, teamBSeed: 3, refSeed: 2 },
      { teamASeed: 5, teamBSeed: 7, refSeed: 6 },
      { teamASeed: 2, teamBSeed: 4, refSeed: 3 },
      { teamASeed: 1, teamBSeed: 6, refSeed: 5 },
      { teamASeed: 2, teamBSeed: 3, refSeed: 4 },
      { teamASeed: 5, teamBSeed: 6, refSeed: 1 },
      { teamASeed: 4, teamBSeed: 7, refSeed: 2 },
      { teamASeed: 1, teamBSeed: 2, refSeed: 6 },
      { teamASeed: 3, teamBSeed: 4, refSeed: 7 }
    ]
  },
  {
    id: '7-team-alt-1',
    label: '7 Team Alt 1 (ECV)',
    teamCount: 7,
    rows: [
      { teamASeed: 1, teamBSeed: 2, refSeed: 6 },
      { teamASeed: 3, teamBSeed: 4, refSeed: 7 },
      { teamASeed: 5, teamBSeed: 6, refSeed: 4 },
      { teamASeed: 7, teamBSeed: 1, refSeed: 3 },
      { teamASeed: 5, teamBSeed: 4, refSeed: 7 },
      { teamASeed: 2, teamBSeed: 3, refSeed: 1 },
      { teamASeed: 7, teamBSeed: 4, refSeed: 5 },
      { teamASeed: 1, teamBSeed: 6, refSeed: 2 },
      { teamASeed: 2, teamBSeed: 5, refSeed: 7 },
      { teamASeed: 3, teamBSeed: 6, refSeed: 1 },
      { teamASeed: 2, teamBSeed: 7, refSeed: 4 },
      { teamASeed: 1, teamBSeed: 5, refSeed: 3 },
      { teamASeed: 4, teamBSeed: 6, refSeed: 5 },
      { teamASeed: 1, teamBSeed: 3, refSeed: 2 },
      { teamASeed: 7, teamBSeed: 6, refSeed: 5 },
      { teamASeed: 2, teamBSeed: 4, refSeed: 3 },
      { teamASeed: 5, teamBSeed: 3, refSeed: 7 },
      { teamASeed: 2, teamBSeed: 6, refSeed: 1 },
      { teamASeed: 7, teamBSeed: 3, refSeed: 2 },
      { teamASeed: 1, teamBSeed: 4, refSeed: 6 },
      { teamASeed: 7, teamBSeed: 5, refSeed: 4 }
    ]
  },
]
