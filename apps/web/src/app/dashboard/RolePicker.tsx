import type { ScenarioDetailView, TeamSeatView } from '@tryout/shared';
import styles from './dashboard.module.css';

interface RolePickerProps {
  scenario: ScenarioDetailView;
  selectedRole: string | null;
  onSelect: (role: string) => void;
}

export function RolePicker({ scenario, selectedRole, onSelect }: RolePickerProps) {
  const seats: TeamSeatView[] = scenario.team.filter((s) => s.selectable);

  return (
    <div>
      <p className={styles.stepLede}>
        You&apos;re joining the team on <strong>{scenario.title}</strong>. Which seat is yours?
      </p>
      <div className={styles.roleGrid}>
        {seats.map((seat) => {
          const active = seat.key === selectedRole;
          return (
            <button
              key={seat.key}
              type="button"
              className={`${styles.roleCard} ${active ? styles.roleCardActive : ''}`}
              onClick={() => onSelect(seat.key)}
              aria-pressed={active}
            >
              <span className={styles.roleCat}>{seat.category}</span>
              <span className={styles.roleTitle}>{seat.title}</span>
              <span className={styles.roleDesc}>{seat.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
