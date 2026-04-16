/**
 * VS Code command: Resolve all conflicts in the active file.
 */

import * as vscode from 'vscode';
import { resolveAllConflicts, applyResolution } from '../core/mergeEngine';
import { getAIConfig } from '../core/secrets';
import { showStrategyPicker } from '../ui/quickPick';
import { CustomInstructionPanelProvider } from '../ui/customInstructionPanel';

export async function executeResolveAllConflicts(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('MergeAI: No active editor.');
    return;
  }

  try {
    const strategy = await showStrategyPicker();
    if (!strategy) return;

    let customInstruction: string | undefined;
    if (strategy === 'custom') {
      customInstruction = await CustomInstructionPanelProvider.promptForInstruction();
      if (customInstruction === undefined) return;
    }

    const aiConfig = await getAIConfig();
    const config = vscode.workspace.getConfiguration('mergeai');
    const contextDepth = config.get<number>('contextDepth', 2);
    const enableValidation = config.get<boolean>('enableValidation', true);
    const warnBeforeSending = config.get<boolean>('warnBeforeSending', true);

    if (warnBeforeSending) {
      const proceed = await vscode.window.showWarningMessage(
        'MergeAI will send code from this file to an external AI service for ALL conflicts. Continue?',
        { modal: true },
        'Continue'
      );
      if (proceed !== 'Continue') return;
    }

    const outcomes = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'MergeAI: Resolving all conflicts...',
        cancellable: false,
      },
      async (progress) => {
        return resolveAllConflicts(
          editor,
          strategy,
          customInstruction,
          aiConfig,
          contextDepth,
          enableValidation
        );
      }
    );

    // Apply the final combined result (last outcome has the fully resolved content)
    if (outcomes.length > 0) {
      const lastOutcome = outcomes[outcomes.length - 1];
      const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        editor.document.lineAt(editor.document.lineCount - 1).range.end
      );

      await editor.edit(editBuilder => {
        editBuilder.replace(fullRange, lastOutcome.newFileContent);
      });

      const hasErrors = outcomes.some(o => !o.validation.success);
      const summary = outcomes
        .map((o, i) => `Conflict ${i + 1}: ${o.result.confidence} confidence`)
        .join(' | ');

      if (hasErrors) {
        vscode.window.showWarningMessage(
          `MergeAI: Resolved ${outcomes.length} conflict(s) with validation warnings. ${summary}`
        );
      } else {
        vscode.window.showInformationMessage(
          `MergeAI: Successfully resolved ${outcomes.length} conflict(s). ${summary}`
        );
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`MergeAI: ${msg}`);
  }
}
