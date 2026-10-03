// `npm run service -- <action>`: hands off to the background-service script for this computer.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = (name) => fileURLToPath(new URL(name, import.meta.url));
const args = process.argv.slice(2);
let result;
if (process.platform === 'win32') {
  result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script('service.ps1'), ...args], { stdio: 'inherit' });
} else if (process.platform === 'darwin') {
  result = spawnSync('/bin/bash', [script('service.sh'), ...args], { stdio: 'inherit' });
} else {
  console.error('The background service is set up for Windows and macOS only. Elsewhere, run npm start under your own service manager.');
  process.exit(1);
}
if (result.error) throw result.error;
process.exit(result.status ?? 1);
