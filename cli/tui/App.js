/**
 * ldc tui — interactive terminal dashboard
 * Root App component using Ink (React for CLIs)
 */
import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { Header } from './components/Header.js';
import { ProjectList } from './components/ProjectList.js';
import { PortMonitor } from './components/PortMonitor.js';
import { ProcessList } from './components/ProcessList.js';
import { LogViewer } from './components/LogViewer.js';
import { StatusBar } from './components/StatusBar.js';

const e = React.createElement;

const TABS = [
  { key: 'projects', label: 'Projects', shortcut: '1' },
  { key: 'processes', label: 'Processes', shortcut: '2' },
  { key: 'ports', label: 'Ports', shortcut: '3' },
  { key: 'logs', label: 'Logs', shortcut: '4' },
];

function App({ daemonUrl, supabase }) {
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState('projects');
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedProcess, setSelectedProcess] = useState(null);
  const [daemonOnline, setDaemonOnline] = useState(false);
  const [termWidth, setTermWidth] = useState(process.stdout.columns || 80);
  const [termHeight, setTermHeight] = useState(process.stdout.rows || 24);

  // Track terminal resize
  useEffect(() => {
    const onResize = () => {
      setTermWidth(process.stdout.columns || 80);
      setTermHeight(process.stdout.rows || 24);
    };
    process.stdout.on('resize', onResize);
    return () => process.stdout.off('resize', onResize);
  }, []);

  // Check daemon health periodically
  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const res = await fetch(`${daemonUrl}/health`);
        if (alive) setDaemonOnline(res.ok);
      } catch {
        if (alive) setDaemonOnline(false);
      }
    }
    check();
    const iv = setInterval(check, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [daemonUrl]);

  // Keyboard navigation
  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }

    // Tab switching via number keys
    for (const tab of TABS) {
      if (input === tab.shortcut) {
        setActiveTab(tab.key);
        return;
      }
    }

    // Tab cycling with Tab key
    if (key.tab) {
      const idx = TABS.findIndex(t => t.key === activeTab);
      const next = key.shift
        ? (idx - 1 + TABS.length) % TABS.length
        : (idx + 1) % TABS.length;
      setActiveTab(TABS[next].key);
    }
  });

  const contentHeight = Math.max(termHeight - 6, 10); // header(2) + tabs(1) + statusbar(2) + padding(1)

  const tabBarElements = TABS.map((tab, i) =>
    e(React.Fragment, { key: tab.key },
      i > 0 ? e(Text, { color: 'gray' }, ' │ ') : null,
      e(Text, {
        bold: activeTab === tab.key,
        color: activeTab === tab.key ? 'cyan' : 'gray',
      }, `${tab.shortcut}:${tab.label}`)
    )
  );

  const contentElement = activeTab === 'projects' ? e(ProjectList, {
    supabase: supabase,
    onSelect: (p) => {
      setSelectedProject(p);
    },
    selected: selectedProject,
  }) : activeTab === 'processes' ? e(ProcessList, {
    daemonUrl: daemonUrl,
    daemonOnline: daemonOnline,
    selectedProject: selectedProject,
    onSelectProcess: setSelectedProcess,
  }) : activeTab === 'ports' ? e(PortMonitor, {
    daemonUrl: daemonUrl,
    daemonOnline: daemonOnline,
    supabase: supabase,
    selectedProject: selectedProject,
  }) : activeTab === 'logs' ? e(LogViewer, {
    daemonUrl: daemonUrl,
    daemonOnline: daemonOnline,
    selectedProcess: selectedProcess,
  }) : null;

  return e(Box, { flexDirection: 'column', width: termWidth },
    e(Header, {
      project: selectedProject,
      daemonOnline: daemonOnline,
      daemonUrl: daemonUrl,
    }),
    e(Box, { paddingLeft: 1 }, ...tabBarElements),
    e(Box, {
      borderStyle: 'single',
      borderColor: 'gray',
      flexDirection: 'column',
      height: contentHeight,
    }, contentElement),
    e(StatusBar, {
      activeTab: activeTab,
      daemonOnline: daemonOnline,
      selectedProject: selectedProject,
    })
  );
}

export function startTui({ daemonPort = 7891, supabase }) {
  const daemonUrl = `http://127.0.0.1:${daemonPort}`;
  const instance = render(
    e(App, { daemonUrl: daemonUrl, supabase: supabase })
  );
  return instance;
}
