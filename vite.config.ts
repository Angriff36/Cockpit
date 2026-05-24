import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn, execSync, type ChildProcess } from 'child_process';
import http from 'http';
import type { Plugin } from 'vite';

function daemonAlive(): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get('http://127.0.0.1:7891/health', () => resolve(true));
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });
}

function killDaemon(): Promise<void> {
  return new Promise(resolve => {
    const req = http.get('http://127.0.0.1:7891/health', res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const { pid } = JSON.parse(data);
          if (process.platform === 'win32') {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          } else {
            process.kill(pid, 'SIGTERM');
          }
        } catch { /* already gone */ }
        // Wait for port to release
        setTimeout(resolve, 800);
      });
    });
    req.on('error', resolve);
    req.setTimeout(500, () => { req.destroy(); resolve(); });
  });
}

function autoDaemon(): Plugin {
  let proc: ChildProcess | null = null;

  return {
    name: 'auto-daemon',
    apply: 'serve',
    async configureServer() {
      // Always restart daemon so new endpoints are loaded
      if (await daemonAlive()) {
        console.log('\x1b[36m[daemon]\x1b[0m restarting with latest code…');
        await killDaemon();
      }

      proc = spawn('node', ['cli/ldc.js', 'daemon'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      proc.stdout?.on('data', d => process.stdout.write(`\x1b[36m[daemon]\x1b[0m ${d}`));
      proc.stderr?.on('data', d => process.stderr.write(`\x1b[36m[daemon]\x1b[0m ${d}`));
      proc.on('exit', (code) => {
        if (code !== 0 && code !== null) process.stderr.write(`\x1b[36m[daemon]\x1b[0m exited with code ${code}\n`);
        proc = null;
      });

      console.log(`\x1b[36m[daemon]\x1b[0m auto-started (pid ${proc.pid})`);

      const stop = () => { try { proc?.kill(); } catch { /* ignore */ } proc = null; };
      process.once('exit', stop);
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), autoDaemon()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
