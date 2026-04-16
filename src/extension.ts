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
import { CustomInstructionPanelProvider } from './ui/customInstructionPanel';
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
  const codeLensProvider = new MergeAICodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
  );

  // Register sidebar view provider
  const sidebarProvider = new MergeAIViewProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('mergeai-commands', sidebarProvider)
  );

  const customInstructionProvider = new CustomInstructionPanelProvider();
  CustomInstructionPanelProvider.setInstance(customInstructionProvider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      CustomInstructionPanelProvider.viewType,
      customInstructionProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  console.log('MergeAI extension activated');
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
