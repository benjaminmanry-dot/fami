import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// Local builds and browser QA must not compete with Ben's active game.
// Hosted Linux builds have no access to the household PC and skip this check.
if (process.platform === 'win32') {
  const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; try { $games=@(Get-Process | Where-Object { $_.ProcessName -in @('EscapeFromTarkov','EscapeFromTarkov_BE','EscapeFromTarkovArena','EscapeFromTarkovArena_BE') }); if($games.Count -gt 0){exit 75}; exit 0 } catch { exit 76 }"
  ], { windowsHide: true, stdio: 'pipe', timeout: 10000 });
  if (result.error || result.status !== 0) {
    // A fresh, explicit Ben instruction can release this Rookery session while
    // the game stays open in the background. This private grant expires and is
    // removed at handoff; it never changes the household's default gaming hold.
    let authorizedBreak = false;
    if (!result.error && result.status === 75) {
      try {
        const grant = JSON.parse(readFileSync(new URL('../.private/heavy-work-authorization.json', import.meta.url), 'utf8'));
        const issued = Date.parse(grant.issuedAt), expires = Date.parse(grant.expiresAt);
        authorizedBreak = grant.scope === 'rookery-current-break' &&
          grant.authorizedBy === 'Ben' && issued <= Date.now() &&
          expires > Date.now() && expires - issued <= 2 * 60 * 60 * 1000;
      } catch { /* no current authorization: preserve the hold */ }
    }
    if (authorizedBreak) {
      console.log('Rookery work permitted for Ben\'s current gaming break.');
    } else {
    console.error(result.status === 75
      ? 'Rookery heavy work is queued: Tarkov is running. Exit the game before building or running browser tests.'
      : 'Rookery heavy work is queued: the gaming check could not verify that the PC is available.');
    process.exit(75);
    }
  }
}
