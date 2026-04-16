/**
 * Merge orchestration engine.
 *
 * Coordinates conflict parsing, context extraction, AI resolution,
 * and validation into a single pipeline.
 */

import * as vscode from 'vscode';
import { parseConflicts, findConflictAtLine, replaceConflict } from './conflictParser';
import { extractContext } from './contextEngine';
import { resolveWithAI } from './aiEngine';
import { validate } from './validator';
import {
  ConflictBlock,
  MergeRequest,
  MergeResult,
  MergeStrategy,
  AIProviderConfig,
  ValidationResult,
  ParsedFile,
} from './types';

export interface ResolutionOutcome {
  result: MergeResult;
  validation: ValidationResult;
  conflict: ConflictBlock;
  newFileContent: string;
}

/**
 * Resolve a single conflict in the active editor.
 */
export async function resolveConflict(
  editor: vscode.TextEditor,
  cursorLine: number,
  strategy: MergeStrategy,
  customInstruction: string | undefined,
  aiConfig: AIProviderConfig,
  contextDepth: number,
  enableValidation: boolean
): Promise<ResolutionOutcome> {
  const document = editor.document;
  const filePath = document.uri.fsPath;
  const fileContent = document.getText();
  const languageId = document.languageId;

  // 1. Parse conflicts
  const parsed = parseConflicts(fileContent, filePath, languageId);
  if (parsed.conflicts.length === 0) {
    throw new Error('No merge conflicts found in this file.');
  }

  // 2. Find conflict at cursor
  const conflict = findConflictAtLine(parsed, cursorLine);
  if (!conflict) {
    throw new Error(
      'No merge conflict found at cursor position. Place your cursor inside a conflict block.'
    );
  }

  // 3. Get workspace root
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error('No workspace folder open.');
  }

  // 4. Extract context
  const context = await extractContext(
    filePath,
    fileContent,
    conflict,
    workspaceRoot,
    contextDepth
  );

  // 5. Build merge request
  const request: MergeRequest = {
    conflict,
    strategy,
    customInstruction,
    context,
    fileContent,
    filePath,
    languageId,
  };

  // 6. Call AI
  const result = await resolveWithAI(request, aiConfig);

  // 7. Build new file content
  const newFileContent = replaceConflict(fileContent, conflict, result.resolvedCode);

  // 8. Validate
  let validation: ValidationResult = { success: true, errors: [], warnings: [] };
  if (enableValidation) {
    validation = await validate(newFileContent, filePath, workspaceRoot);
  }

  return { result, validation, conflict, newFileContent };
}

/**
 * Resolve ALL conflicts in the active editor sequentially.
 */
export async function resolveAllConflicts(
  editor: vscode.TextEditor,
  strategy: MergeStrategy,
  customInstruction: string | undefined,
  aiConfig: AIProviderConfig,
  contextDepth: number,
  enableValidation: boolean
): Promise<ResolutionOutcome[]> {
  const outcomes: ResolutionOutcome[] = [];
  let currentContent = editor.document.getText();
  const filePath = editor.document.uri.fsPath;
  const languageId = editor.document.languageId;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspaceRoot) throw new Error('No workspace folder open.');

  // Parse initial conflicts
  let parsed = parseConflicts(currentContent, filePath, languageId);
  if (parsed.conflicts.length === 0) {
    throw new Error('No merge conflicts found in this file.');
  }

  // Resolve from bottom to top to preserve line numbers
  const conflicts = [...parsed.conflicts].reverse();

  for (const conflict of conflicts) {
    const context = await extractContext(
      filePath,
      currentContent,
      conflict,
      workspaceRoot,
      contextDepth
    );

    const request: MergeRequest = {
      conflict,
      strategy,
      customInstruction,
      context,
      fileContent: currentContent,
      filePath,
      languageId,
    };

    const result = await resolveWithAI(request, aiConfig);
    const newContent = replaceConflict(currentContent, conflict, result.resolvedCode);

    let validation: ValidationResult = { success: true, errors: [], warnings: [] };
    if (enableValidation) {
      validation = await validate(newContent, filePath, workspaceRoot);
    }

    outcomes.push({ result, validation, conflict, newFileContent: newContent });
    currentContent = newContent;
  }

  return outcomes;
}

/**
 * Apply a resolution outcome to the editor.
 */
export async function applyResolution(
  editor: vscode.TextEditor,
  outcome: ResolutionOutcome
): Promise<boolean> {
  const { conflict, result } = outcome;
  const document = editor.document;

  const startPos = new vscode.Position(conflict.startLine, 0);
  const endPos = new vscode.Position(conflict.endLine, document.lineAt(conflict.endLine).text.length);
  const range = new vscode.Range(startPos, endPos);

  const success = await editor.edit(editBuilder => {
    editBuilder.replace(range, result.resolvedCode);
  });

  return success;
}
