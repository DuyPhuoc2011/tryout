import Link from 'next/link';
import styles from './page.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Rendered per request: the Docker build has no API, so any prerender would
// bake an empty featured list into the page.
export const dynamic = 'force-dynamic';

interface ListingSummary {
  id: string;
  slug: string;
  title: string;
  tagline: string;
}

async function getFeatured(): Promise<ListingSummary[]> {
  try {
    const res = await fetch(`${API_URL}/catalog`, { cache: 'no-store' });
    if (!res.ok) return [];
    const all = (await res.json()) as ListingSummary[];
    return all.slice(0, 3);
  } catch {
    // Landing must render even if the API is down — featured section just hides.
    return [];
  }
}

const STEPS = [
  {
    title: 'Pick an incident',
    body: 'Browse real GCP faults: disk-full Postgres, a saturated VPC connector, a scale-to-zero worker trap.',
  },
  {
    title: 'Get the full repo',
    body: 'A one-time purchase invites you, read-only, to the private repo: Terraform, configs, and the runbook.',
  },
  {
    title: 'Break it, blind',
    body: 'Inject the fault, detect it from dashboards and logs alone, then mitigate and write the postmortem.',
  },
];

export default async function LandingPage() {
  const featured = await getFeatured();
  return (
    <main>
      <div className={styles.heroBand}>
        <div className={styles.heroBandInner}>
          <nav className={styles.nav}>
            <Link href="/" className={styles.logo}>
              Try<b>out</b>
            </Link>
            <div className={styles.navLinks}>
              <Link href="/scenarios" className={styles.navLink}>
                Scenarios
              </Link>
              <Link href="/library" className={styles.navLink}>
                Library
              </Link>
              <Link href="/login" className={styles.navCta}>
                Log in
              </Link>
            </div>
          </nav>

          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <h1 className={styles.heroTitle}>
                Deploying is easy. Staying <span className={styles.heroEm}>up</span> is the job.
              </h1>
              <p className={styles.heroSubtext}>
                Real incidents from a production GCP stack, packaged as hands-on labs: the
                Terraform, the configs, the runbook.
              </p>
              <Link href="/scenarios" className={styles.heroCta}>
                Browse scenarios <span aria-hidden="true">→</span>
              </Link>
            </div>

            <div className={styles.panelWrap}>
              <div className={styles.panel} aria-hidden="true">
                <div className={styles.panelHead}>
                  <span className={styles.panelDot} />
                  <span className={styles.panelPath}>docs/incidents/fault-catalog.md · F13</span>
                </div>
                <div className={styles.panelBody}>
                  <p className={styles.panelFault}>Postgres disk full</p>
                  <span className={styles.panelTag}>VM-ONLY · 2026-07-06</span>
                  <hr className={styles.panelRule} />
                  <div className={styles.panelRow}>
                    <span className={styles.panelKey}>detected by</span>
                    <span>a user, not monitoring</span>
                  </div>
                  <div className={styles.panelRow}>
                    <span className={styles.panelKey}>root cause</span>
                    <span>disk at 100%, WAL can&apos;t extend</span>
                  </div>
                  <div className={styles.panelRow}>
                    <span className={styles.panelKey}>missing alert</span>
                    <span className={styles.panelHighlight}>disk-utilization &gt; 85%</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className={styles.page}>
        <section className={styles.steps}>
        {STEPS.map((step, i) => (
          <div className={styles.step} key={step.title}>
            <span className={styles.stepIndex}>{i + 1}</span>
            <h3 className={styles.stepTitle}>{step.title}</h3>
            <p className={styles.stepBody}>{step.body}</p>
          </div>
        ))}
      </section>

      {featured.length > 0 && (
        <section className={styles.featured}>
          <div className={styles.featuredHead}>
            <h2 className={styles.featuredTitle}>Featured scenarios</h2>
            <Link href="/scenarios" className={styles.featuredLink}>
              View all
            </Link>
          </div>
          <ul className={styles.cardGrid}>
            {featured.map((l) => (
              <li key={l.id}>
                <Link href={`/scenarios/${l.slug}`} className={styles.card}>
                  <h3 className={styles.cardTitle}>{l.title}</h3>
                  <p className={styles.cardTagline}>{l.tagline}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className={styles.footer}>
        <span>Tryout. DevOps/SRE scenarios from real incidents.</span>
        <div className={styles.footerLinks}>
          <Link href="/scenarios">Scenarios</Link>
          <Link href="/library">Library</Link>
        </div>
      </footer>
      </div>
    </main>
  );
}
