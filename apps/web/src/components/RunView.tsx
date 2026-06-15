import type { ScenarioRunView } from '@/lib/api';

interface RunViewProps {
  run: ScenarioRunView;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md, 12px)',
  padding: 'var(--space-4)',
  boxShadow: 'var(--shadow-card, 0 1px 3px rgba(0,0,0,0.08))',
};

function CiBadge({ status }: { status: string | null }) {
  const label = status ?? 'pending';
  const color =
    status === 'success'
      ? 'var(--color-success, #16794d)'
      : status === 'failure'
        ? 'var(--color-danger, #b42318)'
        : 'var(--color-muted)';
  return <span style={{ color, fontWeight: 600 }}>CI: {label}</span>;
}

export function RunView({ run }: RunViewProps) {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
      <header>
        <p style={{ color: 'var(--color-muted)', margin: 0 }}>
          {run.scenario?.companyContext.name} · {run.scenario?.companyContext.user_role}
        </p>
        <h1 style={{ fontSize: 'var(--text-xl, 1.75rem)', margin: 'var(--space-1) 0' }}>
          {run.scenario?.title ?? 'Your scenario'}
        </h1>
        <p style={{ color: 'var(--color-muted)', margin: 0 }}>Status: {run.status}</p>
      </header>

      {run.scenario && (
        <section style={cardStyle} aria-labelledby="ticket-heading">
          <h2 id="ticket-heading" style={{ marginTop: 0, fontSize: 'var(--text-md, 1.25rem)' }}>
            {run.scenario.ticket.id}: {run.scenario.ticket.title}
          </h2>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{run.scenario.ticket.body}</p>
        </section>
      )}

      <section style={cardStyle} aria-labelledby="pm-heading">
        <h2 id="pm-heading" style={{ marginTop: 0, fontSize: 'var(--text-md, 1.25rem)' }}>Message from your PM</h2>
        {run.pmIntro ? (
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{run.pmIntro.content}</p>
        ) : (
          <p style={{ color: 'var(--color-muted)', margin: 0 }}>Your PM is writing… (refreshes automatically)</p>
        )}
      </section>

      <section style={cardStyle} aria-labelledby="repo-heading">
        <h2 id="repo-heading" style={{ marginTop: 0, fontSize: 'var(--text-md, 1.25rem)' }}>Your repository</h2>
        {run.repo ? (
          <p style={{ margin: 0 }}>
            <a href={run.repo.url} target="_blank" rel="noreferrer">Open your repo on GitHub →</a>
          </p>
        ) : (
          <p style={{ color: 'var(--color-muted)', margin: 0 }}>Provisioning your repo…</p>
        )}
        <p style={{ marginTop: 'var(--space-2)', color: 'var(--color-muted)' }}>
          Clone it, implement the ticket, and open a pull request. We&apos;ll detect it automatically.
        </p>
      </section>

      <section style={cardStyle} aria-labelledby="review-heading">
        <h2 id="review-heading" style={{ marginTop: 0, fontSize: 'var(--text-md, 1.25rem)' }}>Pull request &amp; review</h2>
        {run.latestSubmission ? (
          <>
            <p style={{ margin: '0 0 var(--space-2)' }}>
              <a href={run.latestSubmission.prUrl} target="_blank" rel="noreferrer">View your PR →</a>{' '}
              · <CiBadge status={run.latestSubmission.ciStatus} />
            </p>
            {run.latestReview ? (
              <div>
                <p style={{ fontWeight: 600, margin: '0 0 var(--space-1)' }}>
                  Senior review:{' '}
                  {run.latestReview.verdict === 'approve' ? 'Approved ✅' : 'Changes requested 🔁'}
                </p>
                {run.latestReview.comments && (
                  <>
                    <p style={{ margin: '0 0 var(--space-1)' }}>{run.latestReview.comments.summary}</p>
                    <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                      {run.latestReview.comments.comments.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : (
              <p style={{ color: 'var(--color-muted)', margin: 0 }}>Senior is reviewing once CI finishes…</p>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--color-muted)', margin: 0 }}>No pull request opened yet.</p>
        )}
      </section>
    </main>
  );
}
