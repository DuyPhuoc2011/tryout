import type { ScorecardView as Scorecard } from '@/lib/api';

interface ScorecardViewProps {
  scorecard: Scorecard;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md, 12px)',
  padding: 'var(--space-4)',
  display: 'grid',
  gap: 'var(--space-3)',
};

function Dimension({ label, score, feedback }: { label: string; score: number; feedback: string }) {
  const color =
    score >= 80 ? 'var(--color-success, #16794d)' : score >= 50 ? '#b8860b' : 'var(--color-danger, #b42318)';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--text-base, 1rem)' }}>{label}</h3>
        <span style={{ fontWeight: 700, fontSize: 'var(--text-lg, 1.5rem)', color }}>{score}<span style={{ color: 'var(--color-muted)', fontSize: 'var(--text-sm, 0.875rem)' }}>/100</span></span>
      </div>
      <p style={{ margin: 'var(--space-1) 0 0', whiteSpace: 'pre-wrap' }}>{feedback}</p>
    </div>
  );
}

export function ScorecardView({ scorecard }: ScorecardViewProps) {
  return (
    <section style={cardStyle} aria-labelledby="scorecard-heading">
      <h2 id="scorecard-heading" style={{ margin: 0, fontSize: 'var(--text-md, 1.25rem)' }}>Your scorecard</h2>
      <Dimension label="Technical" score={scorecard.technicalScore} feedback={scorecard.technicalFeedback} />
      <Dimension label="Professional" score={scorecard.professionalScore} feedback={scorecard.professionalFeedback} />
      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)' }}>
        <h3 style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--text-base, 1rem)' }}>Overall</h3>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{scorecard.overallFeedback}</p>
      </div>
    </section>
  );
}
