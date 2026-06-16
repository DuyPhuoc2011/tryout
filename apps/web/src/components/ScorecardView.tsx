import type { ScorecardView as Scorecard } from '@/lib/api';
import styles from '@/app/run/run.module.css';

interface ScorecardViewProps {
  scorecard: Scorecard;
}

function scoreClass(score: number): string {
  return score >= 80 ? styles.scoreHigh : score >= 50 ? styles.scoreMid : styles.scoreLow;
}

function Dimension({ label, score, feedback }: { label: string; score: number; feedback: string }) {
  const cls = scoreClass(score);
  return (
    <div className={styles.dimension}>
      <div className={styles.dimHead}>
        <span className={styles.dimLabel}>{label}</span>
        <span className={`${styles.dimScore} ${cls}`}>
          {score}
          <small>/100</small>
        </span>
      </div>
      <div className={styles.dimBar}>
        <span
          className={`${styles.dimBarFill} ${cls}`}
          style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: 'currentColor' }}
        />
      </div>
      <p className={styles.dimFeedback}>{feedback}</p>
    </div>
  );
}

export function ScorecardView({ scorecard }: ScorecardViewProps) {
  return (
    <section className={styles.scorecard} aria-labelledby="scorecard-heading">
      <h2 id="scorecard-heading" className={styles.cardTitle} style={{ marginBottom: 0 }}>
        Your scorecard
      </h2>
      <div className={styles.scoreGrid}>
        <Dimension
          label="Technical"
          score={scorecard.technicalScore}
          feedback={scorecard.technicalFeedback}
        />
        <Dimension
          label="Professional"
          score={scorecard.professionalScore}
          feedback={scorecard.professionalFeedback}
        />
      </div>
      <div className={styles.overall}>
        <p className={styles.cardLabel}>Overall</p>
        <p className={styles.prose}>{scorecard.overallFeedback}</p>
      </div>
    </section>
  );
}
