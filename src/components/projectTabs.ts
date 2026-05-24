import {
  FileText, Terminal, Network, Link2, Rocket, KeyRound, Container, Bot, Gauge, Wifi,
  Monitor, StickyNote, ShieldAlert, Activity, Layers, Github, ScrollText, CircleDot,
  BookOpen, GitPullRequest, Webhook,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ProjectTab = {
  id: string;
  label: string;
  icon: LucideIcon;
  group: 'General' | 'Development' | 'GitHub' | 'Infrastructure' | 'Advanced';
};

export const PROJECT_TABS: ProjectTab[] = [
  { id: 'overview', label: 'Overview', icon: FileText, group: 'General' },
  { id: 'notes', label: 'Notes', icon: StickyNote, group: 'General' },
  { id: 'runbooks', label: 'Runbooks', icon: BookOpen, group: 'General' },
  { id: 'controls', label: 'Controls', icon: Gauge, group: 'Development' },
  { id: 'launch', label: 'Launch Groups', icon: Layers, group: 'Development' },
  { id: 'commands', label: 'Commands', icon: Terminal, group: 'Development' },
  { id: 'ports', label: 'Ports', icon: Network, group: 'Development' },
  { id: 'urls', label: 'URLs', icon: Link2, group: 'Development' },
  { id: 'github', label: 'GitHub', icon: Github, group: 'GitHub' },
  { id: 'issues', label: 'Issues', icon: CircleDot, group: 'GitHub' },
  { id: 'prs', label: 'Pull Requests', icon: GitPullRequest, group: 'GitHub' },
  { id: 'ci', label: 'CI', icon: Activity, group: 'GitHub' },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook, group: 'GitHub' },
  { id: 'activity', label: 'Activity Log', icon: ScrollText, group: 'GitHub' },
  { id: 'deployment', label: 'Deployment', icon: Rocket, group: 'Infrastructure' },
  { id: 'env', label: 'Env & Secrets', icon: KeyRound, group: 'Infrastructure' },
  { id: 'docker', label: 'Docker', icon: Container, group: 'Infrastructure' },
  { id: 'ssh', label: 'SSH', icon: Wifi, group: 'Infrastructure' },
  { id: 'machines', label: 'Machines', icon: Monitor, group: 'Infrastructure' },
  { id: 'agent', label: 'Agent Context', icon: Bot, group: 'Advanced' },
  { id: 'dangerzone', label: 'Danger Zone', icon: ShieldAlert, group: 'Advanced' },
];

export type ProjectTabId = (typeof PROJECT_TABS)[number]['id'];

export const TAB_GROUPS = ['General', 'Development', 'GitHub', 'Infrastructure', 'Advanced'] as const;

/** @deprecated Use PROJECT_TABS — kept for keyboard shortcut registration */
export const TABS = PROJECT_TABS;
