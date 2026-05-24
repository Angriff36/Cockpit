import React from 'react';
import { Box, Text } from 'ink';

const e = React.createElement;

export function Header({ project, daemonOnline, daemonUrl }) {
  let titleParts = 'ldc — Local Dev Cockpit';
  if (project) {
    titleParts += ` │ ${project.name || project.slug} (${project.slug})`;
  }

  return e(Box, { paddingLeft: 1, paddingRight: 1, justifyContent: 'space-between' },
    e(Box, null,
      e(Text, { color: 'gray' }, titleParts)
    ),
    e(Box, null,
      e(Text, { color: daemonOnline ? 'green' : 'red' },
        daemonOnline ? '● daemon' : '○ daemon'
      )
    )
  );
}
