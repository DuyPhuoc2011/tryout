'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ScenarioCatalogItem, ScenarioDetailView } from '@tryout/shared';
import { api } from '@/lib/api';
import styles from './dashboard.module.css';
import { ProjectCatalog } from './ProjectCatalog';
import { RolePicker } from './RolePicker';
import { TeamFormation } from './TeamFormation';

const RUN_ID_KEY = 'tryout_run_id';

type Step = 'catalog' | 'role' | 'team';

const STEP_LABELS: { step: Step; label: string }[] = [
  { step: 'catalog', label: 'Project' },
  { step: 'role', label: 'Your role' },
  { step: 'team', label: 'Team' },
];

export function CatalogFlow({ onStarted }: { onStarted: () => void }) {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<ScenarioCatalogItem[] | null>(null);
  const [detail, setDetail] = useState<ScenarioDetailView | null>(null);
  const [step, setStep] = useState<Step>('catalog');
  const [role, setRole] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getScenarios()
      .then((list) => active && setScenarios(list))
      .catch(() => active && setError('Could not load the project catalog.'));
    return () => {
      active = false;
    };
  }, []);

  async function pickScenario(scenario: ScenarioCatalogItem) {
    setError(null);
    try {
      const full = await api.getScenario(scenario.id);
      setDetail(full);
      setRole(full.selectableRoles[0] ?? null);
      setStep('role');
    } catch {
      setError('Could not load that project.');
    }
  }

  async function start() {
    if (!detail || !role) return;
    setStarting(true);
    setError(null);
    try {
      const res = await api.startRun(detail.id, role);
      window.localStorage.setItem(RUN_ID_KEY, res.id);
      onStarted();
      router.push('/run');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the tryout.');
      setStarting(false);
    }
  }

  const activeIndex = STEP_LABELS.findIndex((s) => s.step === step);

  return (
    <div className={styles.flow}>
      <div className={styles.flowHeader}>
        {step !== 'catalog' && (
          <button
            type="button"
            className={styles.stepBack}
            onClick={() => setStep(step === 'team' ? 'role' : 'catalog')}
          >
            ← Back
          </button>
        )}
        <ol className={styles.stepTrail}>
          {STEP_LABELS.map((s, i) => (
            <li
              key={s.step}
              className={`${styles.stepCrumb} ${i === activeIndex ? styles.stepCrumbActive : ''} ${
                i < activeIndex ? styles.stepCrumbDone : ''
              }`}
            >
              <span className={styles.stepNum}>{i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>
      </div>

      {error && <p className={styles.alert}>{error}</p>}

      {step === 'catalog' && (
        <>
          {!scenarios && !error && (
            <div className={styles.center}>
              <span className={styles.spinner} role="status" aria-label="Loading projects" />
            </div>
          )}
          {scenarios && <ProjectCatalog scenarios={scenarios} onPick={pickScenario} />}
        </>
      )}

      {step === 'role' && detail && (
        <RolePicker scenario={detail} selectedRole={role} onSelect={setRole} />
      )}

      {step === 'role' && detail && (
        <div className={styles.startBar}>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => setStep('team')}
            disabled={!role}
          >
            Build your team <span className={styles.arrow}>→</span>
          </button>
        </div>
      )}

      {step === 'team' && detail && role && (
        <TeamFormation
          scenario={detail}
          chosenRole={role}
          starting={starting}
          onStart={start}
        />
      )}
    </div>
  );
}
