import Link from 'next/link';
import type { ScenarioRunView } from '@/lib/api';
import styles from './dashboard.module.css';

const STATUS_COPY: Record<string, string> = {
  onboarding: 'Getting set up',
  in_progress: 'In progress',
  in_review: 'In review',
  grading: 'Grading',
  complete: 'Complete',
};

/** Compact card shown when a run is already in flight — resume, don't restart. */
export function ResumeCard({ run }: { run: ScenarioRunView }) {
  const isComplete = run.status === 'complete';
  const yourSeat = run.team.find((s) => s.isYou);

  return (
    <section className={`${styles.card} ${styles.resumeCard}`}>
      <div className={styles.runHead}>
        <div>
          {run.scenario && (
            <p className={styles.company}>
              {run.scenario.companyContext.name}
              {yourSeat ? ` · ${yourSeat.title}` : ''}
            </p>
          )}
          <h2 className={styles.runTitle}>{run.scenario?.title ?? 'Your tryout'}</h2>
        </div>
        <span
          className={`${styles.statusPill} ${
            isComplete ? styles.statusDone : styles.statusActive
          }`}
        >
          <span className={styles.statusDot} />
          {STATUS_COPY[run.status] ?? run.status}
        </span>
      </div>

      {run.scenario && (
        <div className={styles.ticketRow}>
          <span className={styles.ticketId}>{run.scenario.ticket.id}</span>
          <span className={styles.ticketTitle}>{run.scenario.ticket.title}</span>
        </div>
      )}

      <div className={styles.cardActions}>
        <Link href="/run" className={styles.btnPrimary}>
          {isComplete ? 'View result' : 'Resume tryout'} <span className={styles.arrow}>→</span>
        </Link>
        {run.repo && (
          <a className={styles.btnGhost} href={run.repo.url} target="_blank" rel="noreferrer">
            Open repo
          </a>
        )}
      </div>
    </section>
  );
}
