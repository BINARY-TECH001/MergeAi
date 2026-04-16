/**
 * CodeLens provider for inline "AI Resolve" buttons on conflict markers.
 */

import * as vscode from 'vscode';
import { hasConflicts } from '../core/conflictParser';

export class MergeAICodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor() {
    // Refresh when documents change
    vscode.workspace.onDidChangeTextDocument(() => {
      this._onDidChangeCodeLenses.fire();
    });
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const config = vscode.workspace.getConfiguration('mergeai');
    if (!config.get<boolean>('enableCodeLens', true)) return [];

    const text = document.getText();
    if (!hasConflicts(text)) return [];

    const lenses: vscode.CodeLens[] = [];
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (/^<{7}\s/.test(lines[i])) {
        const range = new vscode.Range(i, 0, i, lines[i].length);

        lenses.push(
          new vscode.CodeLens(range, {
            title: '$(sparkle) AI Resolve',
            command: 'mergeai.resolveConflict',
            tooltip: 'Resolve this conflict with MergeAI',
          }),
          new vscode.CodeLens(range, {
            title: '$(list-flat) Resolve All',
            command: 'mergeai.resolveAllConflicts',
            tooltip: 'Resolve all conflicts in this file',
          })
        );
      }
    }

    return lenses;
  }
}
