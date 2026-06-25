import type { ScenarioRunView } from '@/lib/api';
import styles from '@/app/run/run.module.css';
import { CloneCommand } from './CloneCommand';
import { RunTimeline } from './RunTimeline';

interface RunViewProps {
  run: ScenarioRunView;
}

const STATUS_COPY: Record<string, string> = {
  onboarding: 'Getting set up',
  in_progress: 'In progress',
  in_review: 'In review',
  grading: 'Grading',
  complete: 'Complete',
};

function CiBadge({ status }: { status: string | null }) {
  const label = status ?? 'pending';
  const cls =
    status === 'success' ? styles.ciSuccess : status === 'failure' ? styles.ciFailure : '';
  return <span className={`${styles.ciBadge} ${cls}`}>CI: {label}</span>;
}

export function RunView({ run }: RunViewProps) {
  const isComplete = run.status === 'complete';
  const yourSeat = run.team.find((s) => s.isYou);

  return (
    <>
      <div className={styles.runHeader}>
        <div>
          <p className={styles.company}>
            {run.scenario?.companyContext.name}
            {yourSeat ? ` · ${yourSeat.title}` : ''}
          </p>
          <h1 className={styles.title}>{run.scenario?.title ?? 'Your scenario'}</h1>
        </div>
        <span
          className={`${styles.statusPill} ${isComplete ? styles.statusDone : styles.statusActive}`}
        >
          <span className={styles.statusDot} />
          {STATUS_COPY[run.status] ?? run.status}
        </span>
      </div>

      <RunTimeline run={run} />

      {run.scenario && (
        <section className={styles.card} aria-labelledby="ticket-heading">
          <p className={styles.ticketId}>{run.scenario.ticket.id}</p>
          <h2 id="ticket-heading" className={styles.cardTitle}>
            {run.scenario.ticket.title}
          </h2>
          <p className={styles.prose}>{run.scenario.ticket.body}</p>
        </section>
      )}

      <section className={styles.card} aria-labelledby="pm-heading">
        <p id="pm-heading" className={styles.cardLabel}>
          Message from your PM
        </p>
        {run.pmIntro ? (
          <p className={styles.prose}>{run.pmIntro.content}</p>
        ) : (
          <p className={`${styles.prose} ${styles.muted}`}>
            Your PM is writing… (refreshes automatically)
          </p>
        )}
      </section>

      <section className={styles.card} aria-labelledby="repo-heading">
        <p id="repo-heading" className={styles.cardLabel}>
          Your repository
        </p>
        {run.repo ? (
          <>
            <p className={styles.prose}>
              <a className={styles.link} href={run.repo.url} target="_blank" rel="noreferrer">
                Open your repo on GitHub →
              </a>
            </p>
            <CloneCommand repoUrl={run.repo.url} />
            <p className={styles.hint}>
              Clone it, create a branch, implement the ticket, and open a pull request against{' '}
              <code className={styles.codeInline}>main</code>. We detect it automatically, no need
              to tell us.
            </p>
          </>
        ) : (
          <p className={`${styles.prose} ${styles.muted}`}>Provisioning your repo…</p>
        )}
      </section>

      <section className={styles.card} aria-labelledby="review-heading">
        <p id="review-heading" className={styles.cardLabel}>
          Pull request &amp; review
        </p>
        {run.latestSubmission ? (
          <>
            <div className={styles.prRow}>
              <a
                className={styles.link}
                href={run.latestSubmission.prUrl}
                target="_blank"
                rel="noreferrer"
              >
                View your PR →
              </a>
              <span className={styles.sep}>·</span>
              <CiBadge status={run.latestSubmission.ciStatus} />
            </div>
            {run.latestReview ? (
              <div className={styles.reviewBox}>
                <p
                  className={`${styles.verdict} ${
                    run.latestReview.verdict === 'approve'
                      ? styles.verdictApprove
                      : styles.verdictChanges
                  }`}
                >
                  {run.latestReview.verdict === 'approve'
                    ? 'Senior approved'
                    : 'Senior requested changes'}
                </p>
                {run.latestReview.comments && (
                  <>
                    <p className={styles.reviewSummary}>{run.latestReview.comments.summary}</p>
                    <ul className={styles.reviewList}>
                      {run.latestReview.comments.comments.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : (
              <p className={`${styles.prose} ${styles.muted}`}>
                Senior is reviewing once CI finishes…
              </p>
            )}
          </>
        ) : (
          <p className={`${styles.prose} ${styles.muted}`}>No pull request opened yet.</p>
        )}
      </section>
    </>
  );
}
