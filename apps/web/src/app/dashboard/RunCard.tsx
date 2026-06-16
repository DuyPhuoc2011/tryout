import Link from 'next/link';
import type { ScenarioRunView, ScorecardView } from '@/lib/api';
import styles from './dashboard.module.css';

const LOOP_STEPS = [
  { status: 'onboarding', label: 'Onboarding' },
  { status: 'in_progress', label: 'Building' },
  { status: 'in_review', label: 'In review' },
  { status: 'grading', label: 'Grading' },
  { status: 'complete', label: 'Complete' },
] as const;

const STATUS_COPY: Record<string, string> = {
  onboarding: 'Getting set up',
  in_progress: 'In progress',
  in_review: 'In review',
  grading: 'Grading',
  complete: 'Complete',
};

function scoreClass(score: number): string {
  if (score >= 80) return styles.scoreHigh;
  if (score >= 50) return styles.scoreMid;
  return styles.scoreLow;
}

export function ActiveRunCard({
  run,
  scorecard,
}: {
  run: ScenarioRunView;
  scorecard: ScorecardView | null;
}) {
  const currentIndex = LOOP_STEPS.findIndex((s) => s.status === run.status);
  const isComplete = run.status === 'complete';
  const review = run.latestReview;

  return (
    <section className={styles.card}>
      <div className={styles.runHead}>
        <div>
          {run.scenario && (
            <p className={styles.company}>
              {run.scenario.companyContext.name} · {run.scenario.companyContext.user_role}
            </p>
          )}
          <h2 className={styles.runTitle}>{run.scenario?.title ?? 'Your scenario'}</h2>
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

      <div className={styles.loop}>
        {LOOP_STEPS.map((step, i) => {
          const done = isComplete || (currentIndex >= 0 && i < currentIndex);
          const current = !isComplete && i === currentIndex;
          return (
            <div
              key={step.status}
              className={`${styles.loopStep} ${done ? styles.loopStepDone : ''} ${
                current ? styles.loopStepCurrent : ''
              }`}
            >
              <span className={styles.loopBar}>
                <span className={styles.loopBarFill} />
              </span>
              <span className={styles.loopLabel}>{step.label}</span>
            </div>
          );
        })}
      </div>

      {scorecard ? (
        <div className={styles.scores}>
          <div className={styles.scoreBox}>
            <p className={styles.scoreLabel}>Technical</p>
            <p className={`${styles.scoreValue} ${scoreClass(scorecard.technicalScore)}`}>
              {scorecard.technicalScore}
              <small>/100</small>
            </p>
          </div>
          <div className={styles.scoreBox}>
            <p className={styles.scoreLabel}>Professional</p>
            <p className={`${styles.scoreValue} ${scoreClass(scorecard.professionalScore)}`}>
              {scorecard.professionalScore}
              <small>/100</small>
            </p>
          </div>
        </div>
      ) : (
        <div className={styles.runFacts}>
          <div className={styles.fact}>
            <span className={styles.factKey}>Repo</span>
            {run.repo ? (
              <a className={styles.factLink} href={run.repo.url} target="_blank" rel="noreferrer">
                Open on GitHub →
              </a>
            ) : (
              <span>Provisioning…</span>
            )}
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>PR</span>
            {run.latestSubmission ? (
              <a
                className={styles.factLink}
                href={run.latestSubmission.prUrl}
                target="_blank"
                rel="noreferrer"
              >
                View pull request →
              </a>
            ) : (
              <span>Not opened yet</span>
            )}
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>Review</span>
            {review ? (
              <span
                className={
                  review.verdict === 'approve' ? styles.verdictApprove : styles.verdictChanges
                }
              >
                {review.verdict === 'approve' ? 'Approved' : 'Changes requested'}
              </span>
            ) : (
              <span>Awaiting review</span>
            )}
          </div>
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

export function ContextRail() {
  return (
    <aside className={styles.rail}>
      <div className={styles.railCard}>
        <p className={styles.railTitle}>Your team</p>
        <div className={styles.mate}>
          <span className={`${styles.mateAvatar} ${styles.avatarMai}`}>M</span>
          <div>
            <div className={styles.mateName}>Mai</div>
            <div className={styles.mateRole}>Product Manager</div>
          </div>
        </div>
        <div className={styles.mate}>
          <span className={`${styles.mateAvatar} ${styles.avatarAlex}`}>A</span>
          <div>
            <div className={styles.mateName}>Alex</div>
            <div className={styles.mateRole}>Senior Engineer</div>
          </div>
        </div>
      </div>

      <div className={styles.railCard}>
        <p className={styles.railTitle}>Graded on</p>
        <div className={styles.axisRow}>
          <span className={styles.axisName}>Technical</span>
          <span className={styles.axisHint}>Correctness, design, tests</span>
        </div>
        <div className={styles.axisRow}>
          <span className={styles.axisName}>Professional</span>
          <span className={styles.axisHint}>Communication &amp; follow-through</span>
        </div>
      </div>
    </aside>
  );
}
