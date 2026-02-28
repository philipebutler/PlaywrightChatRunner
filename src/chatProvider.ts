import * as vscode from 'vscode';
import * as fs from 'fs';
import { AVAILABLE_TOOLS, validateActionPlan, ActionPlan } from './actionDsl';
import { PlaywrightRunner, ExecutionResult } from './playwrightRunner';

interface ChatEntry {
  role: 'user' | 'llm' | 'result';
  text: string;
  result?: ExecutionResult;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'playwrightChatRunner.chatView';

  private _view?: vscode.WebviewView;
  private _enabledTools: string[] = [];
  private _chatHistory: ChatEntry[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'submit':
          await this._handleSubmit(message.text as string);
          break;
        case 'loadFile':
          await this._handleLoadFile();
          break;
        case 'exportResults':
          await this._handleExport();
          break;
        case 'updateTools':
          this._enabledTools = message.enabledTools as string[];
          break;
      }
    });
  }

  private async _handleSubmit(text: string): Promise<void> {
    if (!this._view) {
      return;
    }
    this._chatHistory.push({ role: 'user', text });
    this._view.webview.postMessage({ type: 'userMessage', text });

    const token = new vscode.CancellationTokenSource().token;

    try {
      // Build system prompt
      const toolDescriptions = this._buildToolDescriptions();
      const systemPrompt =
        'You are a Playwright automation assistant.\n' +
        'You MUST return ONLY valid JSON in this exact format: { "steps": [ ... ] }\n' +
        'If you need clarification, return: { "clarification": "your question here" }\n' +
        'Do NOT assume missing information. Ask before proceeding if unsure.\n' +
        `Available tools:\n${toolDescriptions}\n` +
        'ONLY use tools from the available list above.';

      const response = await this._callLLM(systemPrompt, text, token);

      // Try to parse as JSON
      let parsed: unknown;
      let isClarification = false;

      try {
        parsed = JSON.parse(response);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'clarification' in (parsed as object)
        ) {
          isClarification = true;
        }
      } catch {
        isClarification = true;
      }

      if (isClarification) {
        let displayText = response;
        if (parsed && typeof parsed === 'object' && 'clarification' in (parsed as object)) {
          displayText = (parsed as { clarification: string }).clarification;
        }
        this._chatHistory.push({ role: 'llm', text: displayText });
        this._view.webview.postMessage({ type: 'llmMessage', text: displayText });
        return;
      }

      // Validate action plan
      const enabledTools = this._enabledTools.length > 0 ? this._enabledTools : AVAILABLE_TOOLS.slice();
      const validation = validateActionPlan(parsed, enabledTools);

      if (!validation.valid || !validation.plan) {
        const errorMsg = `Invalid action plan:\n${validation.errors.join('\n')}`;
        this._chatHistory.push({ role: 'llm', text: errorMsg });
        this._view.webview.postMessage({ type: 'error', text: errorMsg });
        return;
      }

      const plan: ActionPlan = validation.plan;
      const executingMsg = 'Executing plan...';
      this._chatHistory.push({ role: 'llm', text: executingMsg });
      this._view.webview.postMessage({ type: 'llmMessage', text: executingMsg });

      // Execute plan
      const runner = new PlaywrightRunner();
      const results = await runner.executePlan(plan);

      for (const result of results) {
        this._chatHistory.push({ role: 'result', text: JSON.stringify(result), result });
        this._view.webview.postMessage({ type: 'executionResult', result });
      }

      // Feed results back to LLM for interpretation
      const resultsText = results
        .map((r) => `${r.action}: ${r.success ? 'success' : 'failed'} ${r.data ?? ''} ${r.error ?? ''}`)
        .join('\n');

      const interpretationPrompt = `The following Playwright steps were executed:\n${resultsText}\nPlease provide a brief summary of what happened.`;
      const interpretation = await this._callLLM(systemPrompt, interpretationPrompt, token);
      this._chatHistory.push({ role: 'llm', text: interpretation });
      this._view.webview.postMessage({ type: 'llmMessage', text: interpretation });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this._chatHistory.push({ role: 'llm', text: `Error: ${errorMsg}` });
      this._view?.webview.postMessage({ type: 'error', text: errorMsg });
    }
  }

  private async _callLLM(
    systemPrompt: string,
    userText: string,
    token: vscode.CancellationToken
  ): Promise<string> {
    // Check if vscode.lm API is available
    if (!vscode.lm) {
      throw new Error('VS Code Language Model API is not available in this version of VS Code.');
    }

    // Try preferred model families first, then fall back to any Copilot model, then any available model
    let models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    if (!models || models.length === 0) {
      models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o-mini' });
    }
    if (!models || models.length === 0) {
      models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    }
    if (!models || models.length === 0) {
      models = await vscode.lm.selectChatModels();
    }
    if (!models || models.length === 0) {
      throw new Error('No language models available. Please ensure GitHub Copilot is installed and signed in.');
    }

    const model = models[0];
    const messages = [
      vscode.LanguageModelChatMessage.User(`${systemPrompt}\n\nUser request: ${userText}`),
    ];

    const request = await model.sendRequest(messages, {}, token);
    let response = '';
    for await (const chunk of request.text) {
      response += chunk;
    }
    return response.trim();
  }

  private _buildToolDescriptions(): string {
    const tools = this._enabledTools.length > 0 ? this._enabledTools : AVAILABLE_TOOLS.slice();
    const descriptions: Record<string, string> = {
      goto: 'goto: { "action": "goto", "url": "<string>" } - Navigate to a URL',
      clickText: 'clickText: { "action": "clickText", "text": "<string>" } - Click element by visible text',
      type: 'type: { "action": "type", "selector": "<string>", "value": "<string>" } - Type into an element',
      waitForText: 'waitForText: { "action": "waitForText", "text": "<string>" } - Wait for text to appear',
      extractText: 'extractText: { "action": "extractText", "selector": "<string>" } - Extract text from element',
      snapshotText: 'snapshotText: { "action": "snapshotText" } - Get all visible text from page body',
      screenshot: 'screenshot: { "action": "screenshot", "name": "<string>" } - Take a screenshot',
      closeBrowser: 'closeBrowser: { "action": "closeBrowser" } - Close the browser',
    };
    return tools.map((t) => descriptions[t] ?? t).join('\n');
  }

  private async _handleLoadFile(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Text Files': ['txt'] },
      openLabel: 'Load Instructions',
    });

    if (!uris || uris.length === 0) {
      return;
    }

    try {
      const content = fs.readFileSync(uris[0].fsPath, 'utf8');
      this._view?.webview.postMessage({ type: 'loadedFile', text: content });
      // Also process as a submit
      await this._handleSubmit(content);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this._view?.webview.postMessage({ type: 'error', text: `Failed to load file: ${errorMsg}` });
    }
  }

  private async _handleExport(): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      filters: { 'Markdown': ['md'] },
      saveLabel: 'Export Results',
      defaultUri: vscode.Uri.file('playwright-chat-results.md'),
    });

    if (!uri) {
      return;
    }

    try {
      const lines: string[] = ['# Playwright Chat Runner - Export\n'];
      for (const entry of this._chatHistory) {
        if (entry.role === 'user') {
          lines.push(`## User\n\n${entry.text}\n`);
        } else if (entry.role === 'llm') {
          lines.push(`## Assistant\n\n${entry.text}\n`);
        } else if (entry.role === 'result' && entry.result) {
          lines.push(`## Execution Result\n\n\`\`\`json\n${JSON.stringify(entry.result, null, 2)}\n\`\`\`\n`);
        }
      }
      fs.writeFileSync(uri.fsPath, lines.join('\n'), 'utf8');
      vscode.window.showInformationMessage(`Results exported to ${uri.fsPath}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Export failed: ${errorMsg}`);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    const mediaUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media'));
    const cspSource = webview.cspSource;

    // Read the HTML template from media/chat.html
    const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.html');
    try {
      let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
      html = html
        .replace(/\$\{cspSource\}/g, cspSource)
        .replace(/\$\{nonce\}/g, nonce)
        .replace(/\$\{mediaUri\}/g, mediaUri.toString());
      return html;
    } catch {
      return this._getFallbackHtml(nonce, cspSource);
    }
  }

  private _getFallbackHtml(nonce: string, cspSource: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Playwright Chat Runner</title>
</head>
<body>
  <p>Failed to load chat.html from media directory.</p>
</body>
</html>`;
  }
}
