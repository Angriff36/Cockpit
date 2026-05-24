import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

const e = React.createElement;

const STATUS_COLORS = {
  active: 'green',
  paused: 'yellow',
  archived: 'gray',
};

const STATUS_ICONS = {
  active: '●',
  paused: '◐',
  archived: '○',
};

export function ProjectList({ supabase, onSelect, selected }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const visibleRows = Math.max((process.stdout.rows || 24) - 12, 5);

  // Fetch projects
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const { data, error: err } = await supabase
          .from('projects')
          .select('*')
          .order('name');
        if (!alive) return;
        if (err) { setError(err.message); setLoading(false); return; }
        setProjects(data || []);
        setLoading(false);
      } catch (e) {
        if (alive) { setError(e.message); setLoading(false); }
      }
    }
    load();
    // Refresh every 30s
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [supabase]);

  // Keyboard navigation
  useInput((input, key) => {
    if (projects.length === 0) return;

    if (input === 'j' || key.downArrow) {
      setCursor(prev => {
        const next = Math.min(prev + 1, projects.length - 1);
        if (next >= scrollOffset + visibleRows) setScrollOffset(next - visibleRows + 1);
        return next;
      });
    }
    if (input === 'k' || key.upArrow) {
      setCursor(prev => {
        const next = Math.max(prev - 1, 0);
        if (next < scrollOffset) setScrollOffset(next);
        return next;
      });
    }
    if (key.return) {
      onSelect(projects[cursor]);
    }
    if (input === 'g') {
      setCursor(0);
      setScrollOffset(0);
    }
    if (input === 'G') {
      const last = projects.length - 1;
      setCursor(last);
      setScrollOffset(Math.max(0, last - visibleRows + 1));
    }
    if (input === 'r') {
      setLoading(true);
      setError(null);
      supabase.from('projects').select('*').order('name').then(({ data, error: err }) => {
        if (err) { setError(err.message); } else { setProjects(data || []); }
        setLoading(false);
      });
    }
  });

  if (loading) {
    return e(Box, { paddingLeft: 1, paddingTop: 1 },
      e(Text, { color: 'yellow' }, 'Loading projects…')
    );
  }

  if (error) {
    return e(Box, { paddingLeft: 1, paddingTop: 1, flexDirection: 'column' },
      e(Text, { color: 'red' }, `Error: ${error}`),
      e(Text, { color: 'gray' }, 'Press r to retry')
    );
  }

  if (projects.length === 0) {
    return e(Box, { paddingLeft: 1, paddingTop: 1, flexDirection: 'column' },
      e(Text, { color: 'gray' }, 'No projects found.'),
      e(Text, { color: 'gray' }, 'Run `ldc init` from a project directory to get started.')
    );
  }

  const visible = projects.slice(scrollOffset, scrollOffset + visibleRows);

  const projRows = visible.map((p, i) => {
    const idx = scrollOffset + i;
    const isSelected = idx === cursor;
    const isCurrent = selected?.id === p.id;
    const statusColor = STATUS_COLORS[p.status] || 'gray';
    const statusIcon = STATUS_ICONS[p.status] || '?';

    return e(Box, { key: p.id },
      e(Text, { color: isSelected ? 'cyan' : undefined, inverse: isSelected },
        isCurrent ? '▸ ' : '  ',
        e(Text, { color: statusColor }, `${statusIcon} ${(p.status || '').padEnd(8)}`),
        e(Text, { bold: isSelected }, (p.name || '').padEnd(24)),
        e(Text, { color: 'gray' }, (p.slug || '').padEnd(20)),
        e(Text, { color: 'magenta' }, (p.hosting_platform || '-').padEnd(12)),
        e(Text, { color: 'gray' }, (p.package_manager || '-').padEnd(8)),
        e(Text, { color: 'gray' }, p.default_branch || '-')
      )
    );
  });

  return e(Box, { flexDirection: 'column', paddingLeft: 1 },
    // Column headers
    e(Box, null,
      e(Text, { bold: true, color: 'gray' },
        '  ' +
        'Status'.padEnd(10) +
        'Name'.padEnd(24) +
        'Slug'.padEnd(20) +
        'Platform'.padEnd(12) +
        'PM'.padEnd(8) +
        'Branch'
      )
    ),
    e(Box, null,
      e(Text, { color: 'gray' }, '─'.repeat(Math.min(process.stdout.columns - 4, 100)))
    ),
    ...projRows,
    // Scroll indicator
    projects.length > visibleRows ?
      e(Box, { paddingTop: 1 },
        e(Text, { color: 'gray' },
          (scrollOffset > 0 ? '↑ ' : '  ') +
          `${cursor + 1}/${projects.length}` +
          (scrollOffset + visibleRows < projects.length ? ' ↓' : '  ')
        )
      ) : null
  );
}
