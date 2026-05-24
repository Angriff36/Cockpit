import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import WebSocket from 'ws';

const e = React.createElement;

// Strip ANSI escape codes for clean terminal display
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export function LogViewer({ daemonUrl, daemonOnline, selectedProcess }) {
  const [lines, setLines] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const wsRef = useRef(null);

  const visibleRows = Math.max((process.stdout.rows || 24) - 14, 5);
  const maxWidth = Math.max((process.stdout.columns || 80) - 6, 40);

  // WebSocket connection for live logs
  useEffect(() => {
    if (!selectedProcess || !daemonOnline) return;

    const wsUrl = daemonUrl.replace('http://', 'ws://');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        slug: selectedProcess.slug,
        cmdId: selectedProcess.cmdId,
      }));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'backlog' && msg.lines) {
          setLines(msg.lines);
          if (autoScroll) setScrollOffset(Math.max(0, msg.lines.length - visibleRows));
        }
        if (msg.type === 'logs' && msg.lines) {
          setLines(prev => {
            const updated = [...prev, ...msg.lines];
            // Cap at 1000 lines
            const capped = updated.length > 1000 ? updated.slice(-1000) : updated;
            if (autoScroll) setScrollOffset(Math.max(0, capped.length - visibleRows));
            return capped;
          });
        }
      } catch { /* ignore */ }
    });

    ws.on('error', () => {});
    ws.on('close', () => {});

    return () => {
      try {
        ws.send(JSON.stringify({ type: 'unsubscribe' }));
        ws.close();
      } catch {}
      wsRef.current = null;
    };
  }, [daemonUrl, daemonOnline, selectedProcess]);

  useInput((input, key) => {
    if (input === 'j' || key.downArrow) {
      setAutoScroll(false);
      setScrollOffset(prev => Math.min(prev + 1, Math.max(0, lines.length - visibleRows)));
    }
    if (input === 'k' || key.upArrow) {
      setAutoScroll(false);
      setScrollOffset(prev => Math.max(prev - 1, 0));
    }
    if (input === 'G') {
      setAutoScroll(true);
      setScrollOffset(Math.max(0, lines.length - visibleRows));
    }
    if (input === 'g') {
      setAutoScroll(false);
      setScrollOffset(0);
    }
    // Page down / page up
    if (key.pageDown || (key.ctrl && input === 'd')) {
      setAutoScroll(false);
      setScrollOffset(prev => Math.min(prev + visibleRows, Math.max(0, lines.length - visibleRows)));
    }
    if (key.pageUp || (key.ctrl && input === 'u')) {
      setAutoScroll(false);
      setScrollOffset(prev => Math.max(prev - visibleRows, 0));
    }
    if (input === 'f') {
      setAutoScroll(!autoScroll);
    }
    if (input === 'c') {
      setLines([]);
      setScrollOffset(0);
    }
  });

  if (!selectedProcess) {
    return e(Box, { paddingLeft: 1, paddingTop: 1, flexDirection: 'column' },
      e(Text, { color: 'gray' }, 'No process selected.'),
      e(Text, { color: 'gray' }, 'Go to Processes tab → select a process → press Enter → come back here.')
    );
  }

  if (!daemonOnline) {
    return e(Box, { paddingLeft: 1, paddingTop: 1, flexDirection: 'column' },
      e(Text, { color: 'red' }, 'Daemon offline — cannot stream logs'),
      e(Text, { color: 'gray' }, 'Start the daemon: ldc daemon')
    );
  }

  const visible = lines.slice(scrollOffset, scrollOffset + visibleRows);

  const logLines = visible.length === 0 ? [
    e(Text, { color: 'gray' }, '  Waiting for output…')
  ] : visible.map((line, i) => {
    const time = new Date(line.t).toLocaleTimeString();
    const text = stripAnsi(line.text || '').slice(0, maxWidth - 14);
    return e(Box, { key: scrollOffset + i },
      e(Text, { color: 'gray' }, `${time} `),
      e(Text, { color: line.err ? 'red' : 'white' }, text)
    );
  });

  return e(Box, { flexDirection: 'column', paddingLeft: 1 },
    // Log header
    e(Box, null,
      e(Text, { bold: true, color: 'cyan' },
        `Logs: ${selectedProcess.slug}/${selectedProcess.cmdId}`
      ),
      e(Text, { color: 'gray' }, ' │ '),
      e(Text, { color: autoScroll ? 'green' : 'yellow' },
        autoScroll ? 'auto-scroll ON' : 'auto-scroll OFF'
      ),
      e(Text, { color: 'gray' }, ` │ ${lines.length} lines`)
    ),
    e(Box, null,
      e(Text, { color: 'gray' }, '─'.repeat(maxWidth))
    ),
    ...logLines,
    // Scroll indicator
    e(Box, { paddingTop: 1 },
      e(Text, { color: 'gray' },
        (scrollOffset > 0 ? '↑ ' : '  ') +
        (scrollOffset + visibleRows < lines.length ? '↓ ' : '  ') +
        'g/G: top/bottom │ j/k: scroll │ f: toggle follow │ c: clear'
      )
    )
  );
}
