import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

const e = React.createElement;

export function PortMonitor({ daemonUrl, daemonOnline, supabase, selectedProject }) {
  const [ports, setPorts] = useState([]);
  const [liveness, setLiveness] = useState({});
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [lastCheck, setLastCheck] = useState(null);

  // Fetch port definitions from Supabase
  useEffect(() => {
    if (!selectedProject) {
      setPorts([]);
      setLoading(false);
      return;
    }
    let alive = true;
    async function load() {
      try {
        const { data } = await supabase
          .from('project_ports')
          .select('*')
          .eq('project_id', selectedProject.id);
        if (alive) {
          setPorts(data || []);
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [supabase, selectedProject]);

  // Check port liveness via daemon
  useEffect(() => {
    if (!daemonOnline || ports.length === 0) return;
    let alive = true;

    async function check() {
      const portNums = ports.map(p => p.port).join(',');
      try {
        const res = await fetch(`${daemonUrl}/ports?check=${portNums}`);
        const data = await res.json();
        if (alive) {
          setLiveness(data);
          setLastCheck(new Date());
        }
      } catch {
        // daemon down
      }
    }

    check();
    const iv = setInterval(check, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [daemonUrl, daemonOnline, ports]);

  useInput((input, key) => {
    if (ports.length === 0) return;
    if (input === 'j' || key.downArrow) {
      setCursor(prev => Math.min(prev + 1, ports.length - 1));
    }
    if (input === 'k' || key.upArrow) {
      setCursor(prev => Math.max(prev - 1, 0));
    }
    if (input === 'r') {
      // Force re-check
      if (daemonOnline && ports.length > 0) {
        const portNums = ports.map(p => p.port).join(',');
        fetch(`${daemonUrl}/ports?check=${portNums}`)
          .then(r => r.json())
          .then(data => { setLiveness(data); setLastCheck(new Date()); })
          .catch(() => {});
      }
    }
  });

  if (!selectedProject) {
    return e(Box, { paddingLeft: 1, paddingTop: 1 },
      e(Text, { color: 'gray' }, 'Select a project first (go to Projects tab, press Enter)')
    );
  }

  if (loading) {
    return e(Box, { paddingLeft: 1, paddingTop: 1 },
      e(Text, { color: 'yellow' }, 'Loading ports…')
    );
  }

  if (ports.length === 0) {
    return e(Box, { paddingLeft: 1, paddingTop: 1, flexDirection: 'column' },
      e(Text, { color: 'gray' }, `No ports registered for ${selectedProject.slug}`),
      e(Text, { color: 'gray' }, 'Use `ldc add port <port>` to register ports.')
    );
  }

  if (!daemonOnline) {
    const portList = ports.map(p =>
      e(Text, { key: p.id, color: 'gray' }, `  :${p.port} — ${p.label} (${p.protocol})`)
    );

    return e(Box, { paddingLeft: 1, paddingTop: 1, flexDirection: 'column' },
      e(Text, { color: 'red' }, 'Daemon offline — cannot check port liveness'),
      e(Text, { color: 'gray' }, 'Start the daemon: ldc daemon'),
      e(Box, { paddingTop: 1, flexDirection: 'column' }, ...portList)
    );
  }

  const portRows = ports.map((p, i) => {
    const isUp = liveness[p.port] === true;
    const checked = p.port in liveness;
    const isSelected = i === cursor;

    return e(Box, { key: p.id },
      e(Text, { inverse: isSelected, color: isSelected ? 'cyan' : undefined },
        '  ',
        e(Text, { color: !checked ? 'gray' : isUp ? 'green' : 'red' },
          !checked ? '◌ …     ' : isUp ? '● UP    ' : '○ DOWN  '
        ),
        e(Text, null, String(p.port).padEnd(8)),
        e(Text, { bold: isSelected }, (p.label || '').padEnd(24)),
        e(Text, { color: 'gray' }, (p.protocol || 'http').padEnd(10)),
        e(Text, { color: 'gray' }, p.local_url || '')
      )
    );
  });

  return e(Box, { flexDirection: 'column', paddingLeft: 1 },
    // Header
    e(Box, null,
      e(Text, { bold: true, color: 'gray' },
        '  ' +
        'Status'.padEnd(10) +
        'Port'.padEnd(8) +
        'Label'.padEnd(24) +
        'Protocol'.padEnd(10) +
        'URL'
      )
    ),
    e(Box, null,
      e(Text, { color: 'gray' }, '─'.repeat(Math.min(process.stdout.columns - 4, 90)))
    ),
    ...portRows,
    lastCheck ?
      e(Box, { paddingTop: 1 },
        e(Text, { color: 'gray' }, `Last check: ${lastCheck.toLocaleTimeString()} — press r to refresh`)
      ) : null
  );
}
