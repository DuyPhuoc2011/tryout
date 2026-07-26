// Kill whatever is listening on a TCP port, cross-platform. Best-effort:
// swallows "nothing to kill" so it never blocks startup.
// Usage: node scripts/free-port.mjs 3001
import { execSync } from 'node:child_process';

const port = process.argv[2];
if (!port) {
  console.error('usage: node free-port.mjs <port>');
  process.exit(1);
}

function sh(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

const pids = new Set();
if (process.platform === 'win32') {
  for (const line of sh(`netstat -ano -p tcp`).split('\n')) {
    if (line.includes(`:${port} `) && /LISTENING/i.test(line)) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid && pid !== '0') pids.add(pid);
    }
  }
  for (const pid of pids) sh(`taskkill /PID ${pid} /F`);
} else {
  const out = sh(`lsof -ti tcp:${port}`).trim();
  for (const pid of out.split('\n').filter(Boolean)) {
    pids.add(pid);
    sh(`kill -9 ${pid}`);
  }
}

if (pids.size) console.log(`[free-port] freed ${port} (killed ${[...pids].join(', ')})`);
