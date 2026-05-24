import type { DeploymentTarget, Project, ProjectUrl } from './types';
import { resolveHref } from './externalLink';

const PLATFORM_DASHBOARDS: Record<string, string> = {
  vercel: 'https://vercel.com/dashboard',
  render: 'https://dashboard.render.com',
  fly: 'https://fly.io/dashboard',
  railway: 'https://railway.app/dashboard',
  supabase: 'https://supabase.com/dashboard',
};

function firstLinkable(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value?.trim() && resolveHref(value)) return value.trim();
  }
  return null;
}

function buildVercelProjectUrl(dep: DeploymentTarget): string | null {
  const project = dep.platform_project_name?.trim();
  if (!project) return null;
  const team = dep.team_or_org?.trim();
  const path = team ? `${team}/${project}` : project;
  return `https://vercel.com/${path}`;
}

function pickDeployment(
  platform: string,
  deployments: DeploymentTarget[],
): DeploymentTarget | undefined {
  const matching = deployments.filter(d => d.platform?.toLowerCase() === platform);
  if (matching.length === 0) return deployments.find(d => d.environment === 'production') ?? deployments[0];
  return matching.find(d => d.environment === 'production') ?? matching[0];
}

function pickUrl(platform: string, urls: ProjectUrl[]): string | null {
  const normalized = platform.toLowerCase();
  const ranked = urls.filter(u => u.url?.trim());
  const byCategory = ranked.find(u => u.category?.toLowerCase() === normalized);
  if (byCategory) return firstLinkable(byCategory.url);
  if (normalized === 'vercel') {
    const vercelUrl = ranked.find(u => u.category?.toLowerCase() === 'vercel');
    if (vercelUrl) return firstLinkable(vercelUrl.url);
  }
  const production = ranked.find(u => u.category?.toLowerCase() === 'production');
  if (production) return firstLinkable(production.url);
  const dashboard = ranked.find(u => u.category?.toLowerCase() === 'dashboard');
  if (dashboard) return firstLinkable(dashboard.url);
  return null;
}

export function resolveHostingUrl(
  project: Pick<Project, 'hosting_platform'>,
  deployments: DeploymentTarget[] = [],
  urls: ProjectUrl[] = [],
): string | null {
  const platform = project.hosting_platform?.trim().toLowerCase();
  if (!platform) return null;

  const deployment = pickDeployment(platform, deployments);
  if (deployment) {
    const fromDeployment = firstLinkable(
      deployment.dashboard_url,
      deployment.production_url,
      deployment.logs_url,
      platform === 'vercel' ? buildVercelProjectUrl(deployment) : null,
    );
    if (fromDeployment) return fromDeployment;
  }

  const fromUrls = pickUrl(platform, urls);
  if (fromUrls) return fromUrls;

  return PLATFORM_DASHBOARDS[platform] ?? null;
}
