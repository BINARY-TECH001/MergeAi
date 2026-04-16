/**
 * UI utilities: QuickPick, InputBox, and diff preview.
 */

import * as vscode from 'vscode';
import { MergeStrategy } from '../core/types';
import { ResolutionOutcome } from '../core/mergeEngine';

interface StrategyItem extends vscode.QuickPickItem {
  strategy: MergeStrategy;
}

/**
 * Show a QuickPick to select merge strategy.
 */
export async function showStrategyPicker(): Promise<MergeStrategy | undefined> {
  const items: StrategyItem[] = [
    {
      label: '$(merge) Preserve All',
      description: 'Intelligently merge both sides',
      detail: 'Combines logic from current and incoming, avoids duplication',
      strategy: 'preserve-all',
    },
    {
      label: '$(arrow-left) Prefer Current',
      description: 'Keep HEAD changes',
      detail: 'Keeps your current branch changes, discards incoming',
      strategy: 'prefer-current',
    },
    {
      label: '$(arrow-right) Prefer Incoming',
      description: 'Keep incoming changes',
      detail: 'Keeps incoming branch changes, discards current',
      strategy: 'prefer-incoming',
    },
    {
      label: '$(pencil) Custom Instruction',
      description: 'Provide your own merge instruction',
      detail: 'Tell the AI exactly how to merge (e.g., "Keep new API but retain old validation")',
      strategy: 'custom',
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select merge strategy',
    title: 'MergeAI: Choose Resolution Strategy',
  });

  return selected?.strategy;
}

/**
 * Show an InputBox for custom merge instruction.
 */
export async function showCustomInstructionInput(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: 'Describe how you want the conflict resolved',
    placeHolder: 'e.g., "Keep the new API endpoint logic but retain the old validation rules"',
    title: 'MergeAI: Custom Instruction',
    ignoreFocusOut: true,
  });
}

/**
 * Show a diff preview of the resolution and let user accept/reject.
 */
export async function showResolutionPreview(outcome: ResolutionOutcome): Promise<boolean> {
  const { result, conflict } = outcome;

  // Create virtual documents for diff
  const originalUri = vscode.Uri.parse(`mergeai-original:conflict`);
  const resolvedUri = vscode.Uri.parse(`mergeai-resolved:conflict`);

  // Register content providers temporarily
  const originalContent = `// CURRENT (${conflict.currentBranch})\n${conflict.currentContent}\n\n// INCOMING (${conflict.incomingBranch})\n${conflict.incomingContent}`;
  const resolvedContent = `// RESOLVED (${result.strategy} — ${result.confidence} confidence)\n// ${result.reasoning}\n\n${result.resolvedCode}`;

  const provider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return uri.scheme === 'mergeai-original' ? originalContent : resolvedContent;
    }
  })();

  const reg1 = vscode.workspace.registerTextDocumentContentProvider('mergeai-original', provider);
  const reg2 = vscode.workspace.registerTextDocumentContentProvider('mergeai-resolved', provider);

  try {
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      resolvedUri,
      `MergeAI: Conflict → Resolution (${result.confidence} confidence)`
    );

    const action = await vscode.window.showInformationMessage(
      `MergeAI Resolution Preview\n\nStrategy: ${result.strategy}\nConfidence: ${result.confidence}\n${result.reasoning}`,
      { modal: true },
      'Apply',
      'Cancel'
    );

    return action === 'Apply';
  } finally {
    reg1.dispose();
    reg2.dispose();
  }
}
