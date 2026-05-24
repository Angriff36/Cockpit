import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

const e = React.createElement;

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function ProcessList({ daemonUrl, daemonOnline, selectedProject, onSelectProcess }) {
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [now, setNow] = useState(Date.now());

  // Tick every second for uptime display
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Poll daemon /processes
  useEffect(() => {
    if (!daemonOnline) {
      setProcesses([]);
      setLoading(false);
      return;
    }
    let alive = true;

    async function load() {
      try {
        const res = await fetch(`${daemonUrl}/processes`);
        const data = await res.json();
        if (alive) {
          const filtered = selectedProject
            ? data.filter(p => p.slug === selectedProject.slug)
            : data;
          setProcesses(filtered);
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);
      }
    }

    load();
    const iv = setInterval(load, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [daemonUrl, daemonOnline, selectedProject]);

  useInput((input, key) => {
    if (processes.length === 0) return;

    if (input === 'j' || key.downArrow) {
      setCursor(prev => Math.min(prev + 1, processes.length - 1));
    }
    if (input === 'k' || key.upArrow) {
      setCursor(prev => Math.max(prev - 1, 0));
    }
    if (key.return) {
      const proc = processes[cursor];
      if (proc && onSelectProcess) {
        onSelectProcess({ slug: proc.slug, cmdId: proc.cmdId });
      }
    }
    if (input === 's') {
      // Stop selected process
      const proc = processes[cursor];
      if (proc && proc.running) {
        fetch(`${daemonUrl}/processes/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: proc.slug, cmdId: proc.cmdId }),
        }).catch(() => {});
      }
    }
  });

  if (!daemonOnline) {
    return e(Box, { paddingLeft: 1, paddingTop: 1, flexDirection: 'column' },
      e(Text, { color: 'red' }, 'Daemon offline — cannot show processes'),
      e(Text, { color: 'gray' }, 'Start the daemon: ldc daemon')
    );
  }

  if (loading) {
    return e(Box, { paddingLeft: 1, paddingTop: 1 },
      e(Text, { color: 'yellow' }, 'Loading processes…')
    );
  }

  if (processes.length === 0) {
    return e(Box, { paddingLeft: 1, paddingTop: 1, flexDirection: 'column' },
      e(Text, { color: 'gray' }, `No running processes${selectedProject ? ` for ${selectedProject.slug}` : ''}.`),
      e(Text, { color: 'gray' }, 'Start a command from the web UI or use the daemon API.')
    );
  }

  const procRows = processes.map((proc, i) => {
    const isSelected = i === cursor;
    const uptime = proc.running ? formatDuration(now - proc.startedAt) : '-';

    return e(Box, { key: `${proc.slug}:${proc.cmdId}` },
      e(Text, { inverse: isSelected, color: isSelected ? 'cyan' : undefined },
        '  ',
        e(Text, { color: proc.running ? 'green' : 'red' },
          proc.running ? '● RUN   ' : '○ EXIT  '
        ),
        e(Text, { bold: isSelected }, (proc.name || '-').padEnd(20)),
        e(Text, { color: 'gray' }, (proc.kind || '-').padEnd(10)),
        e(Text, { color: 'gray' }, String(proc.pid || '-').padEnd(10)),
        e(Text, { color: 'yellow' }, uptime.padEnd(12)),
        e(Text, { color: 'gray' }, (proc.command || '').slice(0, 40))
      )
    );
  });

  return e(Box, { flexDirection: 'column', paddingLeft: 1 },
    // Header
    e(Box, null,
      e(Text, { bold: true, color: 'gray' },
        '  ' +
        'Status'.padEnd(10) +
        'Name'.padEnd(20) +
        'Kind'.padEnd(10) +
        'PID'.padEnd(10) +
        'Uptime'.padEnd(12) +
        'Command'
      )
    ),
    e(Box, null,
      e(Text, { color: 'gray' }, '─'.repeat(Math.min(process.stdout.columns - 4, 100)))
    ),
    ...procRows,
    e(Box, { paddingTop: 1 },
      e(Text, { color: 'gray' },
        'Enter: view logs │ s: stop process' +
        (selectedProject ? '' : ' │ Hint: select a project to filter')
      )
    )
  );
}
