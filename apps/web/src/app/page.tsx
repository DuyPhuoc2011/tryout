import Link from 'next/link';
import styles from './home.module.css';

/**
 * Public landing page — the first thing a logged-out visitor meets.
 * Dark editorial canvas that extends the auth-panel brand, with the actual
 * product loop (PM message → ticket → senior review) rendered as the hero
 * artifact rather than a stock illustration.
 */
export default function Home() {
  return (
    <div className={styles.page}>
      <div className={styles.grain} aria-hidden />

      <div className={styles.shell}>
        <nav className={styles.nav}>
          <span className={styles.wordmark}>
            Try<b>out</b>
          </span>
          <div className={styles.navActions}>
            <Link href="/login" className={styles.navLink}>
              Log in
            </Link>
            <Link href="/signup" className={styles.btnPrimary}>
              Start a tryout <span className={styles.arrow}>→</span>
            </Link>
          </div>
        </nav>

        {/* ───────────── Hero ───────────── */}
        <header className={styles.hero}>
          <div>
            <p className={`${styles.eyebrow} ${styles.reveal} ${styles.d1}`}>
              <span aria-hidden />
              The AI-resistant junior starts here
            </p>
            <h1 className={`${styles.headline} ${styles.reveal} ${styles.d2}`}>
              Do the job.
              <br />
              Not <em>watch</em> it.
            </h1>
            <p className={`${styles.lede} ${styles.reveal} ${styles.d3}`}>
              Tryout drops you into a software team where every role but yours is AI.
              You get a real GitHub repo, a real ticket, and teammates who message you
              like coworkers. Ship a pull request — get graded on the code{' '}
              <em>and</em> the craft around it.
            </p>
            <div className={`${styles.heroCtas} ${styles.reveal} ${styles.d4}`}>
              <Link href="/signup" className={styles.btnPrimary}>
                Start a tryout <span className={styles.arrow}>→</span>
              </Link>
              <Link href="/login" className={styles.btnGhost}>
                I already have an account
              </Link>
            </div>

            <dl className={`${styles.heroMeta} ${styles.reveal} ${styles.d5}`}>
              <div className={styles.metaItem}>
                <span className={styles.metaNum}>1 repo</span>
                <span className={styles.metaLabel}>A real codebase, not a quiz</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaNum}>2 axes</span>
                <span className={styles.metaLabel}>Technical &amp; professional</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaNum}>0 humans</span>
                <span className={styles.metaLabel}>On the other side</span>
              </div>
            </dl>
          </div>

          {/* The product loop, as a layered artifact. */}
          <div className={styles.collage} aria-hidden>
            <div className={`${styles.card} ${styles.cardSlack}`}>
              <div className={styles.cardHead}>
                <div className={`${styles.avatar} ${styles.avatarMai}`}>M</div>
                <div>
                  <div className={styles.cardName}>Mai</div>
                  <div className={styles.cardRole}>Product Manager</div>
                </div>
              </div>
              <p className={styles.cardBody}>
                Hey! Welcome to the team 👋 Dropped <b>LUMI-142</b> on you — users want
                to archive a task instead of deleting it. Ping me if the spec&apos;s fuzzy.
              </p>
            </div>

            <div className={`${styles.card} ${styles.cardTicket}`}>
              <span className={styles.ticketTag}>LUMI-142</span>
              <p className={styles.ticketTitle}>Archive a task</p>
              <div className={styles.ticketMeta}>
                <span className={styles.chip}>backend</span>
                <span className={styles.chip}>POST /tasks/:id/archive</span>
              </div>
            </div>

            <div className={`${styles.card} ${styles.cardReview}`}>
              <div className={styles.cardHead}>
                <div className={`${styles.avatar} ${styles.avatarAlex}`}>A</div>
                <div>
                  <div className={styles.cardName}>Alex</div>
                  <div className={styles.cardRole}>Senior Engineer</div>
                </div>
              </div>
              <pre className={styles.diff}>
                <span className={styles.diffCtx}>  archive(id: string) {'{'}</span>
                {'\n'}
                <span className={styles.diffDel}>-   this.tasks.delete(id);</span>
                {'\n'}
                <span className={styles.diffAdd}>+   task.archivedAt = new Date();</span>
                {'\n'}
                <span className={styles.diffCtx}>  {'}'}</span>
              </pre>
              <span className={styles.verdict}>Changes requested · nice catch on the soft-delete</span>
            </div>
          </div>
        </header>

        {/* ───────────── The loop ───────────── */}
        <section id="how-it-works" className={styles.section}>
          <p className={`${styles.kicker} ${styles.onScroll}`}>How it works</p>
          <h2 className={`${styles.sectionTitle} ${styles.onScroll}`}>
            A workday, compressed into one ticket.
          </h2>
          <p className={`${styles.sectionLede} ${styles.onScroll}`}>
            No whiteboard, no trick questions. You work the way you actually work —
            read the codebase, talk to your team, open a PR, take the review.
          </p>

          <div className={styles.steps}>
            <article className={`${styles.step} ${styles.onScroll}`}>
              <div className={styles.stepNum}>01</div>
              <h3 className={styles.stepTitle}>Get the repo</h3>
              <p className={styles.stepBody}>
                We spin up a real GitHub repository from a live service and hand you a
                ticket. Your PM introduces the work in chat, just like day one.
              </p>
            </article>
            <article className={`${styles.step} ${styles.onScroll}`}>
              <div className={styles.stepNum}>02</div>
              <h3 className={styles.stepTitle}>Ship a PR</h3>
              <p className={styles.stepBody}>
                Clone, implement, open a pull request. CI runs against your branch and a
                senior engineer reviews the real diff — and expects you to respond to it.
              </p>
            </article>
            <article className={`${styles.step} ${styles.onScroll}`}>
              <div className={styles.stepNum}>03</div>
              <h3 className={styles.stepTitle}>Get graded</h3>
              <p className={styles.stepBody}>
                A scorecard rates the code you wrote and how you carried yourself —
                clarity, follow-through, and how you handled the review.
              </p>
            </article>
          </div>
        </section>

        {/* ───────────── Teammates ───────────── */}
        <section className={styles.section}>
          <p className={`${styles.kicker} ${styles.onScroll}`}>Your team</p>
          <h2 className={`${styles.sectionTitle} ${styles.onScroll}`}>
            Coworkers, not chatbots.
          </h2>
          <p className={`${styles.sectionLede} ${styles.onScroll}`}>
            Two AI teammates with opinions and a job to do. How you work with them is
            part of what gets measured.
          </p>

          <div className={styles.teamGrid}>
            <article className={`${styles.mate} ${styles.onScroll}`}>
              <div className={styles.mateHead}>
                <div className={`${styles.mateAvatar} ${styles.avatarMai}`}>M</div>
                <div>
                  <div className={styles.mateName}>Mai</div>
                  <div className={styles.mateRole}>Product Manager</div>
                </div>
              </div>
              <p className={styles.mateQuote}>
                Writes the ticket, owns the “why,” and answers your scope questions —
                if you ask the right ones.
              </p>
            </article>
            <article className={`${styles.mate} ${styles.onScroll}`}>
              <div className={styles.mateHead}>
                <div className={`${styles.mateAvatar} ${styles.avatarAlex}`}>A</div>
                <div>
                  <div className={styles.mateName}>Alex</div>
                  <div className={styles.mateRole}>Senior Engineer</div>
                </div>
              </div>
              <p className={styles.mateQuote}>
                Reads your diff line by line, requests changes when they&apos;re due, and
                notices whether you push back well or just nod.
              </p>
            </article>
          </div>
        </section>

        {/* ───────────── Two axes ───────────── */}
        <section className={styles.section}>
          <p className={`${styles.kicker} ${styles.onScroll}`}>The scorecard</p>
          <h2 className={`${styles.sectionTitle} ${styles.onScroll}`}>
            Graded on two axes.
          </h2>
          <p className={`${styles.sectionLede} ${styles.onScroll}`}>
            Anyone can prompt an LLM into a passing diff. Tryout measures the part that
            doesn&apos;t come for free.
          </p>

          <div className={styles.axes}>
            <div className={`${styles.axis} ${styles.onScroll}`}>
              <p className={styles.axisLabel}>Axis 01 — Technical</p>
              <h3 className={styles.axisTitle}>Does the code hold up?</h3>
              <ul className={styles.axisList}>
                <li>Correctness against the acceptance suite</li>
                <li>Design that fits the existing codebase</li>
                <li>Tests, edge cases, and clean diffs</li>
                <li>Green CI before you call it done</li>
              </ul>
            </div>
            <div className={`${styles.axis} ${styles.onScroll}`}>
              <p className={styles.axisLabel}>Axis 02 — Professional</p>
              <h3 className={styles.axisTitle}>Would we work with you?</h3>
              <ul className={styles.axisList}>
                <li>Clear, well-timed communication</li>
                <li>Asking the right questions early</li>
                <li>Taking a code review with grace</li>
                <li>Follow-through from ticket to merge</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ───────────── Closing CTA ───────────── */}
        <section className={`${styles.closer} ${styles.onScroll}`}>
          <h2 className={styles.closerTitle}>
            Stop describing the work. <em>Do it.</em>
          </h2>
          <p className={styles.closerLede}>
            One ticket, one repo, one pull request. See how you stack up when the team
            is watching the work, not the keywords.
          </p>
          <Link href="/signup" className={styles.btnPrimary}>
            Start a tryout <span className={styles.arrow}>→</span>
          </Link>
        </section>

        <footer className={styles.footer}>
          <span className={styles.wordmark}>
            Try<b>out</b>
          </span>
          <span>The AI-resistant junior starts here.</span>
        </footer>
      </div>
    </div>
  );
}
