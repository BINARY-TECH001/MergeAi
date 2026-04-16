/**
 * VS Code command: Resolve a single merge conflict at cursor.
 */

import * as vscode from 'vscode';
import { resolveConflict, applyResolution, ResolutionOutcome } from '../core/mergeEngine';
import { getAIConfig } from '../core/secrets';
import { MergeStrategy } from '../core/types';
import { showStrategyPicker, showCustomInstructionInput, showResolutionPreview } from '../ui/quickPick';

export async function executeResolveConflict(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('MergeAI: No active editor.');
    return;
  }

  try {
    // 1. Pick strategy
    const strategy = await showStrategyPicker();
    if (!strategy) return; // cancelled

    // 2. Custom instruction if needed
    let customInstruction: string | undefined;
    if (strategy === 'custom') {
      customInstruction = await showCustomInstructionInput();
      if (customInstruction === undefined) return; // cancelled
    }

    // 3. Get AI config
    const aiConfig = await getAIConfig();
    const config = vscode.workspace.getConfiguration('mergeai');
    const contextDepth = config.get<number>('contextDepth', 2);
    const enableValidation = config.get<boolean>('enableValidation', true);
    const confirmBeforeApply = config.get<boolean>('confirmBeforeApply', true);
    const warnBeforeSending = config.get<boolean>('warnBeforeSending', true);

    // 4. Security warning
    if (warnBeforeSending) {
      const proceed = await vscode.window.showWarningMessage(
        'MergeAI will send code from this file to an external AI service. Continue?',
        { modal: true },
        'Continue',
        'Continue & Don\'t Ask Again'
      );
      if (!proceed) return;
      if (proceed === 'Continue & Don\'t Ask Again') {
        await config.update('warnBeforeSending', false, vscode.ConfigurationTarget.Global);
      }
    }

    // 5. Resolve
    const cursorLine = editor.selection.active.line;

    const outcome = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'MergeAI: Resolving conflict...',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Extracting context...' });
        const result = await resolveConflict(
          editor,
          cursorLine,
          strategy,
          customInstruction,
          aiConfig,
          contextDepth,
          enableValidation
        );
        return result;
      }
    );

    // 6. Show validation warnings
    if (!outcome.validation.success) {
      const errCount = outcome.validation.errors.length;
      const action = await vscode.window.showWarningMessage(
        `MergeAI: Validation found ${errCount} error(s). The resolved code may have issues.`,
        'Apply Anyway',
        'Show Errors',
        'Cancel'
      );
      if (action === 'Show Errors') {
        const errorText = outcome.validation.errors
          .map(e => `[${e.source}] Line ${e.line ?? '?'}: ${e.message}`)
          .join('\n');
        const doc = await vscode.workspace.openTextDocument({ content: errorText, language: 'text' });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        return;
      }
      if (action !== 'Apply Anyway') return;
    }

    // 7. Preview or apply
    if (confirmBeforeApply) {
      const accepted = await showResolutionPreview(outcome);
      if (!accepted) return;
    }

    const applied = await applyResolution(editor, outcome);
    if (applied) {
      const emoji = outcome.result.confidence === 'high' ? '✅' :
                     outcome.result.confidence === 'medium' ? '⚠️' : '❌';
      vscode.window.showInformationMessage(
        `${emoji} MergeAI: Conflict resolved (${outcome.result.confidence} confidence). ${outcome.result.reasoning}`
      );
    } else {
      vscode.window.showErrorMessage('MergeAI: Failed to apply resolution.');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`MergeAI: ${msg}`);
  }
}
