import type { ScenarioDetailView } from '@tryout/shared';
import styles from './dashboard.module.css';

interface TeamFormationProps {
  scenario: ScenarioDetailView;
  chosenRole: string;
  starting: boolean;
  onStart: () => void;
}

/** A two-letter fallback initial for AI-less seats. */
function seatInitial(title: string): string {
  return title.charAt(0).toUpperCase();
}

export function TeamFormation({ scenario, chosenRole, starting, onStart }: TeamFormationProps) {
  return (
    <div>
      <p className={styles.stepLede}>
        Here&apos;s your team on <strong>{scenario.title}</strong>. The other seats are filled by
        AI teammates — you talk to the interactive ones as you work.
      </p>

      <div className={styles.roster}>
        {scenario.team.map((seat) => {
          const isYou = seat.key === chosenRole;
          const initial = seat.aiInitial ?? (isYou ? 'You' : seatInitial(seat.title));
          return (
            <div key={seat.key} className={`${styles.seat} ${isYou ? styles.seatYou : ''}`}>
              <span className={styles.seatAvatar} data-you={isYou}>
                {isYou ? 'You' : initial}
              </span>
              <div className={styles.seatBody}>
                <div className={styles.seatName}>
                  {isYou ? 'You' : seat.aiName ?? 'AI teammate'}
                  {seat.interactive && !isYou && (
                    <span className={styles.seatTag}>chats with you</span>
                  )}
                  {isYou && <span className={styles.seatTagYou}>your seat</span>}
                </div>
                <div className={styles.seatRole}>{seat.title}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.startBar}>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={onStart}
          disabled={starting}
        >
          {starting ? 'Setting up your workspace…' : 'Start the tryout'}
          {!starting && <span className={styles.arrow}>→</span>}
        </button>
      </div>
    </div>
  );
}
