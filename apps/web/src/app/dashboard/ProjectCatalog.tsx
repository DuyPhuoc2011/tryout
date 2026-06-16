import {
  PROJECT_TYPE_LABELS,
  PROJECT_TYPES,
  type ProjectType,
  type ScenarioCatalogItem,
} from '@tryout/shared';
import styles from './dashboard.module.css';

interface ProjectCatalogProps {
  scenarios: ScenarioCatalogItem[];
  onPick: (scenario: ScenarioCatalogItem) => void;
}

const DIFFICULTY_LABEL: Record<string, string> = {
  intro: 'Intro',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export function ProjectCatalog({ scenarios, onPick }: ProjectCatalogProps) {
  // Group by project type, preserving the canonical type order.
  const byType = new Map<ProjectType, ScenarioCatalogItem[]>();
  for (const s of scenarios) {
    const list = byType.get(s.projectType) ?? [];
    list.push(s);
    byType.set(s.projectType, list);
  }

  return (
    <div className={styles.catalog}>
      {PROJECT_TYPES.filter((type) => byType.has(type)).map((type) => (
        <section key={type} className={styles.catalogGroup}>
          <h2 className={styles.groupLabel}>{PROJECT_TYPE_LABELS[type]}</h2>
          <div className={styles.cardsGrid}>
            {byType.get(type)!.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`${styles.projectCard} ${
                  s.available ? '' : styles.projectCardDisabled
                }`}
                onClick={() => s.available && onPick(s)}
                disabled={!s.available}
                aria-disabled={!s.available}
              >
                <div className={styles.projectCardHead}>
                  <span className={styles.projectCompany}>{s.companyName || '—'}</span>
                  {s.available ? (
                    <span className={styles.difficulty}>
                      {DIFFICULTY_LABEL[s.difficulty] ?? s.difficulty}
                    </span>
                  ) : (
                    <span className={styles.soonBadge}>Coming soon</span>
                  )}
                </div>
                <h3 className={styles.projectTitle}>{s.title}</h3>
                <p className={styles.projectSummary}>{s.summary}</p>
                <div className={styles.tagRow}>
                  {s.tags.map((tag) => (
                    <span key={tag} className={styles.tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                {s.available && <span className={styles.projectCta}>Choose this project →</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
