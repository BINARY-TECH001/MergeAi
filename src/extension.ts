/**
 * MergeAI extension entry point.
 *
 * Registers commands, CodeLens provider, and initializes secure storage.
 */

import * as vscode from 'vscode';
import { executeResolveConflict } from './commands/resolveConflict';
import { executeResolveAllConflicts } from './commands/resolveAllConflicts';
import { executeResolveAllConflictsInWorkspace } from './commands/resolveAllConflictsInWorkspace';
import { executeConfigure } from './commands/configure';
import { MergeAICodeLensProvider } from './ui/codeLens';
import { MergeAIViewProvider } from './ui/sidebar';
import { initSecretStorage } from './core/secrets';

export function activate(context: vscode.ExtensionContext): void {
  // Initialize secure API key storage
  initSecretStorage(context);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('mergeai.resolveConflict', executeResolveConflict),
    vscode.commands.registerCommand('mergeai.resolveAllConflicts', executeResolveAllConflicts),
    vscode.commands.registerCommand('mergeai.resolveAllConflictsInWorkspace', executeResolveAllConflictsInWorkspace),
    vscode.commands.registerCommand('mergeai.configure', executeConfigure)
  );

  // Register CodeLens provider for all supported languages
  const languages = [
    { language: 'typescript' },
    { language: 'typescriptreact' },
    { language: 'javascript' },
    { language: 'javascriptreact' },
    { language: 'json' },
    { language: 'css' },
    { language: 'html' },
    { language: 'markdown' },
    { language: 'yaml' },
  ];

  const codeLensProvider = new MergeAICodeLensProvider();
  for (const selector of languages) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(selector, codeLensProvider)
    );
  }

  // Register sidebar view provider
  const sidebarProvider = new MergeAIViewProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('mergeai-commands', sidebarProvider)
  );

  console.log('MergeAI extension activated');
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
