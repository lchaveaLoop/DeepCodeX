import type { AgentRunState, VerificationResult } from '@fagent/agent';

function countToolResults(run: AgentRunState): {
  total: number;
  succeeded: number;
  failed: number;
} {
  const toolResults = run.steps.filter((step) => step.kind === 'tool_result');
  const succeeded = toolResults.filter((step) => step.data?.ok === true).length;
  const failed = toolResults.filter((step) => step.data?.ok === false).length;
  return { total: toolResults.length, succeeded, failed };
}

function latestResultFor(
  command: string,
  results: VerificationResult[],
): VerificationResult | undefined {
  return [...results].reverse().find((result) => result.command === command);
}

function deliveryStatus(run: AgentRunState): string {
  const verification = run.verification;
  if (!verification || verification.commands.length === 0) return 'no verification configured';

  const requiredCommands = verification.commands.filter((command) => command.required);
  if (requiredCommands.length === 0) return 'ready';

  const requiredResults = requiredCommands.map((command) =>
    latestResultFor(command.command, verification.results),
  );

  if (requiredResults.some((result) => result?.status === 'failed')) {
    return 'verification failed';
  }

  if (!run.workspaceChanges?.changed) {
    return 'ready (no workspace changes)';
  }

  if (requiredResults.some((result) => result?.status !== 'passed')) {
    return 'needs verification';
  }

  return 'ready';
}

function workspaceChangeText(run: AgentRunState): string {
  const count = run.workspaceChanges?.changes.length ?? 0;
  return count > 0 ? String(count) : 'none';
}

export function renderRunSummary(run: AgentRunState | null): string {
  if (!run) return 'No run has completed yet.';

  const tools = countToolResults(run);
  const lines = [
    `Run: ${run.status}`,
    `Delivery: ${deliveryStatus(run)}`,
    `Workspace changes: ${workspaceChangeText(run)}`,
    `Rounds: ${run.totalRounds}`,
    `Tools: ${tools.total} total, ${tools.succeeded} succeeded, ${tools.failed} failed`,
  ];

  const verification = run.verification;
  if (verification && verification.commands.length > 0) {
    const passed = verification.results.filter((result) => result.status === 'passed').length;
    const failed = verification.results.filter((result) => result.status === 'failed').length;
    const failedText = failed > 0 ? `, ${failed} failed` : '';
    lines.push(`Verification: ${passed}/${verification.commands.length} passed${failedText}`);

    for (const command of verification.commands) {
      const result = latestResultFor(command.command, verification.results);
      const status = result?.status ?? 'pending';
      lines.push(`  [${status}] ${command.command}`);
    }
  } else {
    lines.push('Verification: no commands inferred');
  }

  return lines.join('\n');
}
