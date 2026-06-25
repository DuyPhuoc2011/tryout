'use client';

/*
 * Copy-paste clone command for the candidate's repo. Isolated client leaf so
 * RunView itself stays a plain (non-interactive) component. The fresh-grad
 * audience needs the exact command, not "clone it and open a PR" prose.
 */

import { useState } from 'react';
import styles from '@/app/run/run.module.css';

interface CloneCommandProps {
  repoUrl: string;
}

export function CloneCommand({ repoUrl }: CloneCommandProps) {
  const [copied, setCopied] = useState(false);
  // repoUrl is the GitHub html url; the clone url is the same + ".git".
  const command = `git clone ${repoUrl}.git`;

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.clone}>
      <code className={styles.cloneCmd}>{command}</code>
      <button type="button" className={styles.cloneCopy} onClick={copy}>
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}
