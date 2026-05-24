import React from 'react';
import { Box, Text } from 'ink';

const e = React.createElement;

export function StatusBar({ activeTab, daemonOnline, selectedProject }) {
  const helpText = 'Tab switch  1-4 jump  j/k navigate  Enter select  q quit';

  return e(Box, { paddingLeft: 1, justifyContent: 'space-between' },
    e(Text, { color: 'gray' }, helpText),
    e(Box, null,
      selectedProject ?
        e(Text, { color: 'gray' }, selectedProject.slug) : null
    )
  );
}
