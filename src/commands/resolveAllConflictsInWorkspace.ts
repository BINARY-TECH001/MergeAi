/**
 * VS Code command: Resolve all merge conflicts across the entire workspace.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseConflicts, replaceConflict } from '../core/conflictParser';
import { extractContext } from '../core/contextEngine';
import { resolveWithAI } from '../core/aiEngine';
import { validate } from '../core/validator';
import { getAIConfig } from '../core/secrets';
import { showStrategyPicker, showCustomInstructionInput } from '../ui/quickPick';
import { MergeStrategy, AIProviderConfig } from '../core/types';

interface FileResolutionResult {
  filePath: string;
  conflictCount: number;
  success: boolean;
  error?: string;
}

export async function executeResolveAllConflictsInWorkspace(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('MergeAI: No workspace folder open.');
    return;
  }

  try {
    // 1. Pick strategy
    const strategy = await showStrategyPicker();
    if (!strategy) return;

    let customInstruction: string | undefined;
    if (strategy === 'custom') {
      customInstruction = await showCustomInstructionInput();
      if (customInstruction === undefined) return;
    }

    // 2. Get AI config
    const aiConfig = await getAIConfig();
    const config = vscode.workspace.getConfiguration('mergeai');
    const contextDepth = config.get<number>('contextDepth', 2);
    const enableValidation = config.get<boolean>('enableValidation', true);
    const warnBeforeSending = config.get<boolean>('warnBeforeSending', true);

    // 3. Security warning
    if (warnBeforeSending) {
      const proceed = await vscode.window.showWarningMessage(
        'MergeAI will scan and resolve ALL conflicts in the workspace. Code will be sent to external AI service. Continue?',
        { modal: true },
        'Continue',
        'Continue & Don\'t Ask Again'
      );
      if (!proceed) return;
      if (proceed === 'Continue & Don\'t Ask Again') {
        await config.update('warnBeforeSending', false, vscode.ConfigurationTarget.Global);
      }
    }

    // 4. Scan workspace for conflicted files
    const results: FileResolutionResult[] = [];

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'MergeAI: Scanning workspace for conflicts...',
        cancellable: false,
      },
      async (progress) => {
        const conflictedFiles = await findConflictedFiles(workspaceFolders[0].uri.fsPath);

        if (conflictedFiles.length === 0) {
          vscode.window.showInformationMessage('MergeAI: No merge conflicts found in workspace.');
          return;
        }

        progress.report({ message: `Found ${conflictedFiles.length} file(s) with conflicts.` });

        // 5. Resolve each file
        for (let i = 0; i < conflictedFiles.length; i++) {
          const filePath = conflictedFiles[i];
          progress.report({
            message: `Resolving ${i + 1}/${conflictedFiles.length}: ${path.basename(filePath)}`,
            increment: (100 / conflictedFiles.length) * 0.8,
          });

          const result = await resolveFileConflicts(
            filePath,
            strategy,
            customInstruction,
            aiConfig,
            contextDepth,
            enableValidation,
            workspaceFolders[0].uri.fsPath
          );
          results.push(result);
        }
      }
    );

    // 6. Show results
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    const totalConflicts = results.reduce((sum, r) => sum + r.conflictCount, 0);

    if (failureCount > 0) {
      const errorDetails = results
        .filter(r => !r.success)
        .map(r => `  • ${path.basename(r.filePath)}: ${r.error}`)
        .join('\n');
      vscode.window.showWarningMessage(
        `MergeAI: Resolved ${totalConflicts} conflict(s) across ${successCount}/${results.length} file(s).\n\nFailed:\n${errorDetails}`
      );
    } else {
      vscode.window.showInformationMessage(
        `✅ MergeAI: Successfully resolved ${totalConflicts} conflict(s) across ${successCount} file(s) using ${strategy} strategy.`
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`MergeAI: ${msg}`);
  }
}

/**
 * Find all files in workspace with merge conflicts.
 */
async function findConflictedFiles(workspaceRoot: string): Promise<string[]> {
  const conflictedFiles: string[] = [];
  const ignore = ['.git', 'node_modules', '.vscode', 'out', 'dist', '.env'];

  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignore.includes(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          // Only check text files
          if (/\.(ts|tsx|js|jsx|py|java|go|rb|php|c|cpp|h|cs|rs|swift|kt|scala|clj|lua|vim|txt|md|json|yaml|yml|xml|html|css|scss|less)$/i.test(entry.name)) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              if (/^<{7}\s/m.test(content) && /^>{7}\s/m.test(content)) {
                conflictedFiles.push(fullPath);
              }
            } catch {
              // Skip files we can't read
            }
          }
        }
      }
    } catch {
      // Skip directories we can't access
    }
  }

  walk(workspaceRoot);
  return conflictedFiles;
}

/**
 * Resolve all conflicts in a single file.
 */
async function resolveFileConflicts(
  filePath: string,
  strategy: MergeStrategy,
  customInstruction: string | undefined,
  aiConfig: AIProviderConfig,
  contextDepth: number,
  enableValidation: boolean,
  workspaceRoot: string
): Promise<FileResolutionResult> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseConflicts(content, filePath, 'typescript');

    if (parsed.conflicts.length === 0) {
      return { filePath, conflictCount: 0, success: true };
    }

    let newContent = content;

    // Resolve from bottom to top to preserve line numbers
    const conflicts = [...parsed.conflicts].reverse();

    for (const conflict of conflicts) {
      try {
        const context = await extractContext(filePath, newContent, conflict, workspaceRoot, contextDepth);
        const result = await resolveWithAI(
          {
            conflict,
            strategy,
            customInstruction,
            context,
            fileContent: newContent,
            filePath,
            languageId: 'typescript',
          },
          aiConfig
        );
        newContent = replaceConflict(newContent, conflict, result.resolvedCode);
      } catch (err) {
        return {
          filePath,
          conflictCount: parsed.conflicts.length,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    // Validate if enabled
    if (enableValidation) {
      await validate(newContent, filePath, workspaceRoot);
    }

    // Write resolved content back to file
    fs.writeFileSync(filePath, newContent, 'utf-8');

    return { filePath, conflictCount: parsed.conflicts.length, success: true };
  } catch (err) {
    return {
      filePath,
      conflictCount: 0,
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
