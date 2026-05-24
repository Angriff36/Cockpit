import { useState } from 'react';
import { ExternalLink, Loader2, Rocket } from 'lucide-react';
import type { DeploymentTarget, Project, ProjectScope } from '../lib/types';
import { insertDeploymentHistory } from '../lib/api';
import { canDeployViaGitHubActions, pickVercelDeployment, triggerVercelGitHubDeploy } from '../lib/githubActionsDeploy';
import { Button } from './ui';

type Props = {
  scope: Pick<ProjectScope, 'project' | 'deployments'>;
  deployment?: DeploymentTarget | null;
  onDeployed?: () => void;
  compact?: boolean;
  className?: string;
};

export function GitHubDeployButton({
  scope,
  deployment = null,
  onDeployed,
  compact = false,
  className = '',
}: Props) {
  const [busy, setBusy] = useState(false);

  const target = deployment ?? pickVercelDeployment(scope.deployments);
  const canDeploy = canDeployViaGitHubActions(scope.project, scope.deployments);

  if (!canDeploy) return null;

  async function handleDeploy() {
    const label = target?.platform || scope.project.hosting_platform || 'Vercel';
    const branch = target?.branch?.trim() || scope.project.default_branch || 'main';
    const workflowHint = target?.github_workflow_file?.trim();

    const message = workflowHint
      ? `Deploy to ${label} via GitHub Actions?\n\nWorkflow: ${workflowHint}\nBranch: ${branch}`
      : `Deploy to ${label} via GitHub Actions?\n\nBranch: ${branch}\n\nCockpit will auto-detect a deploy/vercel workflow with workflow_dispatch.`;

    if (!confirm(message)) return;

    setBusy(true);
    try {
      const result = await triggerVercelGitHubDeploy({
        repoUrl: scope.project.repo_url,
        project: scope.project,
        deployment: target,
        deployments: scope.deployments,
      });

      try {
        await insertDeploymentHistory({
          project_id: scope.project.id,
          deployment_target_id: target?.id ?? null,
          platform: target?.platform || 'vercel',
          environment: target?.environment || 'production',
          trigger_source: 'github_actions',
          status: result.run?.status === 'completed'
            ? (result.run.conclusion === 'success' ? 'success' : 'failed')
            : 'deploying',
          deploy_command: `workflow_dispatch:${result.workflow.path}`,
          branch: result.branch,
          deployment_url: target?.production_url || result.run?.html_url || '',
          commit_sha: result.run?.head_sha || '',
          notes: result.run?.html_url || result.actionsUrl || '',
        });
      } catch {
        /* history is best-effort */
      }

      onDeployed?.();

      if (result.run?.html_url) {
        const open = confirm(
          `GitHub Actions deploy started (${result.workflow.name}).\n\nOpen the workflow run in your browser?`,
        );
        if (open) window.open(result.run.html_url, '_blank', 'noopener,noreferrer');
      } else if (result.actionsUrl) {
        alert(`Deploy dispatched (${result.workflow.name}). Check GitHub Actions for progress.`);
      } else {
        alert(`Deploy dispatched (${result.workflow.name}).`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Deploy failed';
      alert(message);
    } finally {
      setBusy(false);
    }
  }

  const label = compact ? 'Deploy' : 'Deploy via Actions';

  return (
    <Button
      disabled={busy}
      onClick={handleDeploy}
      className={className}
      title="Trigger a GitHub Actions workflow_dispatch deploy (Vercel)"
    >
      {busy
        ? <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
        : compact
          ? <Rocket className="w-3 h-3 inline mr-1" />
          : <ExternalLink className="w-3 h-3 inline mr-1" />}
      {label}
    </Button>
  );
}

export function projectCanGitHubDeploy(project: Project, deployments: DeploymentTarget[]): boolean {
  return canDeployViaGitHubActions(project, deployments);
}
