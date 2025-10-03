#!/usr/bin/env node
// Simple timeout wrapper that streams child output and kills after N seconds
const { spawn } = require('node:child_process');

function printUsage() {
  console.error('Usage: with-timeout <seconds> <cmd> [args...]');
}

const [,, secondsArg, ...cmdArgs] = process.argv;
if (!secondsArg || !cmdArgs.length) {
  printUsage();
  process.exit(2);
}

const seconds = Number(secondsArg);
if (!Number.isFinite(seconds) || seconds <= 0) {
  console.error('Invalid seconds value:', secondsArg);
  process.exit(2);
}

const child = spawn(cmdArgs[0], cmdArgs.slice(1), {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error(`\n[with-timeout] Timeout reached after ${seconds}s. Sending SIGTERM...`);
  child.kill('SIGTERM');
  // Force kill after grace period
  setTimeout(() => {
    if (!child.killed) {
      console.error('[with-timeout] Forcing SIGKILL...');
      child.kill('SIGKILL');
    }
  }, 5000);
}, seconds * 1000);

// Forward termination signals
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (timedOut) {
    process.exitCode = 124; // common timeout exit code
  } else if (signal) {
    console.error(`[with-timeout] Child exited due to signal: ${signal}`);
    process.exitCode = 128; 
  } else {
    process.exitCode = code ?? 0;
  }
});

