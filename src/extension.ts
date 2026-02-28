import * as vscode from 'vscode';
import { ChatViewProvider } from './chatProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('playwrightChatRunner.open', () => {
      vscode.commands.executeCommand('workbench.view.extension.playwrightChatRunner');
    })
  );
}

export function deactivate(): void {}
