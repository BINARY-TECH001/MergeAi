/**
 * MergeAI sidebar view provider.
 * 
 * Provides a tree view in the sidebar with all MergeAI commands and status.
 */

import * as vscode from 'vscode';

export class MergeAIViewProvider implements vscode.TreeDataProvider<MergeAITreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<MergeAITreeItem | undefined | null | void> =
    new vscode.EventEmitter<MergeAITreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<MergeAITreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MergeAITreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: MergeAITreeItem): Thenable<MergeAITreeItem[]> {
    if (!element) {
      // Root items
      return Promise.resolve([
        new MergeAITreeItem(
          'Resolve All Conflicts in Workspace',
          '$(batch)',
          vscode.TreeItemCollapsibleState.None,
          'mergeai.resolveAllConflictsInWorkspace',
          'Scan and resolve all merge conflicts in the workspace'
        ),
        new MergeAITreeItem(
          'Resolve Conflict at Cursor',
          '$(git-merge)',
          vscode.TreeItemCollapsibleState.None,
          'mergeai.resolveConflict',
          'Resolve the merge conflict at your cursor position'
        ),
        new MergeAITreeItem(
          'Resolve All in File',
          '$(list-flat)',
          vscode.TreeItemCollapsibleState.None,
          'mergeai.resolveAllConflicts',
          'Resolve all conflicts in the active file'
        ),
        new MergeAITreeItem(
          'Configure Provider',
          '$(gear)',
          vscode.TreeItemCollapsibleState.None,
          'mergeai.configure',
          'Set up AI provider (OpenAI, Anthropic, Gemini, Custom)'
        ),
        new MergeAITreeItem(
          'Open Settings Dashboard',
          '$(settings-gear)',
          vscode.TreeItemCollapsibleState.None,
          'mergeai.openSettings',
          'Manage provider, model, endpoint, and API keys in one view'
        ),
      ]);
    }
    return Promise.resolve([]);
  }
}

export class MergeAITreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    private readonly icon: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly commandId?: string,
    public readonly description?: string
  ) {
    super(label, collapsibleState);
    this.tooltip = description || label;
    this.iconPath = new vscode.ThemeIcon(icon.replace(/^\$\(|\)$/g, ''));
    
    if (commandId) {
      this.command = {
        title: label,
        command: commandId,
      };
    }
  }
}
