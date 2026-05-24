import type { DeploymentTarget, Project } from './types';
import {
  dispatchWorkflow,
  fetchRepoWorkflows,
  getActionsUrl,
  pickDeployWorkflow,
  waitForDispatchedRun,
} from './github';
import type { GitHubWorkflow, GitHubWorkflowRun } from './types';

export type GitHubDeployResult = {
  workflow: GitHubWorkflow;
  run: GitHubWorkflowRun | null;
  actionsUrl: string | null;
  branch: string;
};

export function pickVercelDeployment(deployments: DeploymentTarget[]): DeploymentTarget | null {
  return (
    deployments.find(d => d.platform === 'vercel' && d.environment === 'production')
    ?? deployments.find(d => d.platform === 'vercel')
    ?? null
  );
}

export function canDeployViaGitHubActions(project: Project, deployments: DeploymentTarget[]): boolean {
  if (!project.repo_url?.includes('github.com')) return false;
  if (project.hosting_platform === 'vercel') return true;
  return deployments.some(d => d.platform === 'vercel');
}

export async function triggerVercelGitHubDeploy(options: {
  repoUrl: string;
  project: Project;
  deployment: DeploymentTarget | null;
  deployments: DeploymentTarget[];
}): Promise<GitHubDeployResult> {
  const { repoUrl, project, deployment, deployments } = options;
  const target = deployment ?? pickVercelDeployment(deployments);
  const branch = target?.branch?.trim() || project.default_branch?.trim() || 'main';
  const workflowFile = target?.github_workflow_file?.trim() || '';

  const workflows = await fetchRepoWorkflows(repoUrl);
  if (workflows.length === 0) {
    throw new Error('No GitHub Actions workflows found in this repository.');
  }

  const workflow = pickDeployWorkflow(workflows, {
    platform: target?.platform || project.hosting_platform || 'vercel',
    workflowFile,
  });

  if (!workflow) {
    throw new Error(
      'No deploy workflow found. Add a workflow with workflow_dispatch (e.g. deploy.yml) or set GitHub workflow file on the deployment target.',
    );
  }

  const dispatchedAt = new Date();
  await dispatchWorkflow(repoUrl, workflow.id, branch);

  const run = await waitForDispatchedRun(repoUrl, workflow.id, branch, dispatchedAt);

  return {
    workflow,
    run,
    actionsUrl: getActionsUrl(repoUrl),
    branch,
  };
}
