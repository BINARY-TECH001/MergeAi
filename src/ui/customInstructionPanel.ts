/**
 * MergeAI custom instruction webview panel.
 *
 * Provides a bottom sidebar input area for custom merge instructions.
 */

import * as vscode from 'vscode';

type InstructionRequest = {
  resolve: (value: string | undefined) => void;
  reject: (reason?: unknown) => void;
};

export class CustomInstructionPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mergeai-custom-instruction';

  private view?: vscode.WebviewView;
  private pendingRequest?: InstructionRequest;
  private currentInstruction = '';

  private static instance: CustomInstructionPanelProvider | undefined;

  static setInstance(instance: CustomInstructionPanelProvider): void {
    CustomInstructionPanelProvider.instance = instance;
  }

  static async promptForInstruction(): Promise<string | undefined> {
    return CustomInstructionPanelProvider.instance
      ? CustomInstructionPanelProvider.instance.promptForInstruction()
      : Promise.resolve(undefined);
  }

  static getCurrentInstruction(): string {
    return CustomInstructionPanelProvider.instance?.getCurrentInstruction() ?? '';
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.onDidDispose(() => {
      if (this.pendingRequest) {
        this.pendingRequest.resolve(undefined);
        this.pendingRequest = undefined;
      }
      this.view = undefined;
    });

    webviewView.webview.onDidReceiveMessage(message => {
      switch (message.type) {
        case 'submit': {
          const instruction = String(message.value ?? '').trim();
          this.currentInstruction = instruction;
          if (this.pendingRequest) {
            this.pendingRequest.resolve(instruction || undefined);
            this.pendingRequest = undefined;
          }
          break;
        }
        case 'cancel': {
          if (this.pendingRequest) {
            this.pendingRequest.resolve(undefined);
            this.pendingRequest = undefined;
          }
          break;
        }
        case 'clear': {
          this.currentInstruction = '';
          break;
        }
        case 'ready': {
          webviewView.webview.postMessage({
            type: 'hydrate',
            value: this.currentInstruction,
          });
          break;
        }
      }
    });
  }

  async promptForInstruction(): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => {
      this.pendingRequest = { resolve, reject: () => resolve(undefined) };

      void (async () => {
        try {
          await vscode.commands.executeCommand('workbench.view.extension.mergeai-view');
          await new Promise(delayResolve => setTimeout(delayResolve, 75));

          if (this.view) {
            await this.view.show(true);
            this.view.webview.postMessage({ type: 'hydrate', value: this.currentInstruction });
            this.view.webview.postMessage({ type: 'focus' });
            return;
          }
        } catch {
          // Fall through to cancellation below.
        }

        resolve(undefined);
        this.pendingRequest = undefined;
      })();
    });
  }

  getCurrentInstruction(): string {
    return this.currentInstruction;
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = String(Date.now());
    const style = `
      <style>
        :root {
          color-scheme: light dark;
        }
        body {
          margin: 0;
          padding: 10px;
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background: var(--vscode-sideBar-background);
        }
        .wrap {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .title {
          font-size: 12px;
          font-weight: 600;
          opacity: 0.9;
          letter-spacing: 0.02em;
        }
        .hint {
          font-size: 11px;
          opacity: 0.72;
          line-height: 1.35;
        }
        textarea {
          width: 100%;
          min-height: 60px;
          height: 72px;
          max-height: 180px;
          resize: vertical;
          border-radius: 10px;
          border: 1px solid var(--vscode-input-border, transparent);
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          padding: 9px 10px;
          box-sizing: border-box;
          outline: none;
          font: inherit;
          line-height: 1.45;
        }
        textarea:focus {
          border-color: var(--vscode-focusBorder);
          box-shadow: 0 0 0 1px var(--vscode-focusBorder);
        }
        .actions {
          display: flex;
          gap: 8px;
        }
        button {
          border: none;
          border-radius: 8px;
          padding: 8px 10px;
          cursor: pointer;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
        }
        button.secondary {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
        }
      </style>
    `;

    const script = `
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const textarea = document.getElementById('instruction');
        const sendButton = document.getElementById('send');
        const clearButton = document.getElementById('clear');
        const cancelButton = document.getElementById('cancel');

        const focusInput = () => {
          textarea.focus();
          const end = textarea.value.length;
          textarea.setSelectionRange(end, end);
        };

        const hydrateInput = (value) => {
          textarea.value = value || '';
          focusInput();
        };

        window.addEventListener('DOMContentLoaded', () => {
          focusInput();
          vscode.postMessage({ type: 'ready' });
        });

        window.addEventListener('message', event => {
          const message = event.data;
          if (message.type === 'hydrate') {
            hydrateInput(message.value);
          }
          if (message.type === 'focus') {
            focusInput();
          }
        });

        sendButton.addEventListener('click', () => {
          vscode.postMessage({ type: 'submit', value: textarea.value });
        });

        clearButton.addEventListener('click', () => {
          textarea.value = '';
          focusInput();
          vscode.postMessage({ type: 'clear' });
        });

        cancelButton.addEventListener('click', () => {
          vscode.postMessage({ type: 'cancel' });
        });

        textarea.addEventListener('keydown', event => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            vscode.postMessage({ type: 'submit', value: textarea.value });
          }
        });
      </script>
    `;

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        ${style}
      </head>
      <body>
        <div class="wrap">
          <div class="title">Custom Merge Instruction</div>
          <div class="hint">Type the merge instruction here. Press Cmd/Ctrl + Enter to submit. This will be reused by the custom strategy.</div>
          <textarea id="instruction" autofocus spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="e.g. Keep the new API shape, but preserve old validation rules."></textarea>
          <div class="actions">
            <button id="send">Use Instruction</button>
            <button id="clear" class="secondary">Clear</button>
            <button id="cancel" class="secondary">Cancel</button>
          </div>
        </div>
        ${script}
      </body>
      </html>`;
  }
}
