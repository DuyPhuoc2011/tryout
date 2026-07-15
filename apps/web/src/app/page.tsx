import Link from 'next/link';

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

export default async function LandingPage() {
  const featured = await getFeatured();
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '4rem 1.5rem' }}>
      <nav style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
        <Link href="/scenarios">Scenarios</Link>
        <Link href="/library">Library</Link>
        <Link href="/login">Log in</Link>
      </nav>

      <section style={{ padding: '4rem 0' }}>
        <h1>Deploying is easy. Keeping it alive is the job.</h1>
        <p>
          Tryout sells real DevOps/SRE scenarios — actual incidents from production GCP
          infrastructure, packaged as hands-on labs: the Terraform, the configs, the runbook,
          and the story of what broke.
        </p>
        <Link href="/scenarios">Browse scenarios →</Link>
      </section>

      {featured.length > 0 && (
        <section>
          <h2>Featured scenarios</h2>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '1rem' }}>
            {featured.map((l) => (
              <li key={l.id}>
                <Link href={`/scenarios/${l.slug}`}>
                  <h3>{l.title}</h3>
                  <p>{l.tagline}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
