import type { ReactNode } from 'react';

/**
 * Two-panel auth layout: an editorial brand panel that carries the product's
 * positioning, paired with the form surface. Deliberately not a centered
 * default card — the split composition gives the screen a point of view.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        minHeight: '100dvh',
      }}
    >
      <aside
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          padding: 'clamp(2rem, 5vw, 4.5rem)',
          color: 'white',
          background:
            'linear-gradient(155deg, oklch(34% 0.11 264) 0%, oklch(24% 0.07 270) 100%)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display), sans-serif',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            fontSize: '1.25rem',
          }}
        >
          Try<b style={{ color: 'var(--color-signal, oklch(84% 0.14 86))', fontWeight: 600 }}>out</b>
        </span>
        <div>
          <p
            style={{
              fontFamily: 'var(--font-display), sans-serif',
              fontSize: 'var(--text-display)',
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              fontWeight: 600,
              margin: '0 0 var(--space-3)',
            }}
          >
            Do the job.
            <br />
            Not{' '}
            <span style={{ color: 'var(--color-signal, oklch(84% 0.14 86))', fontWeight: 700 }}>
              watch
            </span>{' '}
            it.
          </p>
          <p style={{ maxWidth: '34ch', color: 'oklch(86% 0.03 264)', lineHeight: 1.55, margin: 0 }}>
            Join a software team where every other role is an AI teammate. Ship a real pull
            request on a real codebase, and get graded on the code and the craft around it.
          </p>
        </div>
        <span style={{ color: 'oklch(78% 0.03 264)', fontSize: 'var(--text-sm)' }}>
          The AI-resistant junior starts here.
        </span>
      </aside>

      <section
        style={{
          display: 'grid',
          placeItems: 'center',
          padding: 'clamp(2rem, 5vw, 4rem)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 380 }}>{children}</div>
      </section>
    </main>
  );
}

export function FieldStack({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {children}
    </div>
  );
}
