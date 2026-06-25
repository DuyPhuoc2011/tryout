import type { ScenarioRunView } from '@/lib/api';
import styles from '@/app/run/run.module.css';

/*
 * Live progress timeline for a run. The real work happens off-platform (clone,
 * code, push), so the async wait can feel like a void. This makes "where am I"
 * legible and turns the 15s poll into visible motion. Pure derivation from run
 * state — no new data, no interactivity.
 */

type StepState = 'done' | 'active' | 'todo' | 'fail';

interface Step {
  label: string;
  hint: string;
  state: StepState;
}

function computeSteps(run: ScenarioRunView): Step[] {
  const ci = run.latestSubmission?.ciStatus ?? null;
  const done = {
    repo: !!run.repo,
    ticket: !!run.pmIntro,
    pr: !!run.latestSubmission,
    ci: ci === 'success',
    review: !!run.latestReview,
    graded: run.status === 'complete',
  };

  // Ordered checkpoints with a plain boolean "done". The first not-done step
  // becomes "active"; CI failure is called out as a fail so it reads as the
  // thing to act on, not a dead end.
  const raw: { label: string; hint: string; done: boolean; fail?: boolean }[] = [
    { label: 'Repo ready', hint: 'Your GitHub repository is provisioned.', done: done.repo },
    { label: 'Ticket assigned', hint: 'Your PM posted the ticket in chat.', done: done.ticket },
    { label: 'Open a pull request', hint: 'Clone, implement, and push a PR. We detect it automatically.', done: done.pr },
    {
      label: 'CI passes',
      hint: ci === 'failure' ? 'CI failed — push a fix to your branch.' : 'CI runs the test suite on your PR.',
      done: done.ci,
      fail: ci === 'failure',
    },
    { label: 'Senior review', hint: 'Alex reviews your diff and replies.', done: done.review },
    { label: 'Graded', hint: 'Submit for grading to get your scorecard.', done: done.graded },
  ];

  const firstTodo = raw.findIndex((s) => !s.done);
  return raw.map((s, i) => ({
    label: s.label,
    hint: s.hint,
    state: s.done ? 'done' : s.fail ? 'fail' : i === firstTodo ? 'active' : 'todo',
  }));
}

export function RunTimeline({ run }: { run: ScenarioRunView }) {
  const steps = computeSteps(run);
  return (
    <section className={styles.card} aria-labelledby="timeline-heading">
      <p id="timeline-heading" className={styles.cardLabel}>
        Your progress
      </p>
      <ol className={styles.timeline}>
        {steps.map((step) => (
          <li key={step.label} className={`${styles.tlStep} ${styles[`tl_${step.state}`]}`}>
            <span className={styles.tlDot} aria-hidden />
            <div className={styles.tlBody}>
              <span className={styles.tlLabel}>{step.label}</span>
              <span className={styles.tlHint}>{step.hint}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
