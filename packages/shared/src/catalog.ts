export const PROJECT_TYPES = [
  'backend_monolith',
  'microservices',
  'frontend_web',
  'mobile',
  'desktop',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Human label for each project type, for catalog grouping/badges. */
export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  backend_monolith: 'Backend monolith',
  microservices: 'Microservices',
  frontend_web: 'Frontend web app',
  mobile: 'Mobile app',
  desktop: 'Desktop app',
};

export const TEAM_ROLE_CATEGORIES = ['leadership', 'engineering', 'design', 'qa'] as const;
export type TeamRoleCategory = (typeof TEAM_ROLE_CATEGORIES)[number];

export type ScenarioDifficulty = 'intro' | 'intermediate' | 'advanced';

/** Catalog display metadata stored in `definition.catalog`. */
export interface ScenarioCatalogMeta {
  summary: string;
  difficulty: ScenarioDifficulty;
  tags: string[];
}

/** A single card in the project catalog (GET /scenarios). */
export interface ScenarioCatalogItem {
  id: string;
  title: string;
  projectType: ProjectType;
  summary: string;
  difficulty: ScenarioDifficulty;
  tags: string[];
  available: boolean;
  companyName: string;
}

/** One seat in a scenario's team, resolved against the team-roles table. */
export interface TeamSeatView {
  key: string;
  title: string;
  description: string;
  category: TeamRoleCategory;
  aiName: string | null;
  aiInitial: string | null;
  interactive: boolean;
  /** Whether a candidate may claim this seat in this scenario. */
  selectable: boolean;
}

/** GET /scenarios/:id — catalog item plus the resolved team. */
export interface ScenarioDetailView extends ScenarioCatalogItem {
  team: TeamSeatView[];
  selectableRoles: string[];
}
