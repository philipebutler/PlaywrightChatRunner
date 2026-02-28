import * as playwright from 'playwright';
import * as os from 'os';
import * as path from 'path';
import { ActionPlan, ActionStep } from './actionDsl';

export interface ExecutionResult {
  action: string;
  success: boolean;
  data?: string;
  error?: string;
}

export class PlaywrightRunner {
  async executePlan(plan: ActionPlan): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    let browser: playwright.Browser | null = null;
    let page: playwright.Page | null = null;

    try {
      browser = await playwright.chromium.launch({ headless: true });
      const context = await browser.newContext();
      page = await context.newPage();

      for (const step of plan.steps) {
        if (step.action === 'closeBrowser') {
          results.push(await this.executeStep(step, page));
          // Close the browser and stop further steps
          break;
        }
        results.push(await this.executeStep(step, page));
      }
    } catch (err) {
      results.push({
        action: 'browser-init',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          // ignore close errors
        }
      }
    }

    return results;
  }

  private async executeStep(step: ActionStep, page: playwright.Page): Promise<ExecutionResult> {
    try {
      switch (step.action) {
        case 'goto':
          if (!step.url) {
            return { action: step.action, success: false, error: '"url" is required for goto' };
          }
          try {
            const parsed = new URL(step.url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              return { action: step.action, success: false, error: `Only http and https URLs are allowed, got "${parsed.protocol}"` };
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { action: step.action, success: false, error: `Invalid URL: "${step.url}" - ${msg}` };
          }
          await page.goto(step.url, { timeout: 30000 });
          return { action: step.action, success: true };

        case 'clickText':
          await page.getByText(step.text!, { exact: false }).first().click({ timeout: 10000 });
          return { action: step.action, success: true };

        case 'type':
          await page.locator(step.selector!).fill(step.value!, { timeout: 10000 });
          return { action: step.action, success: true };

        case 'waitForText':
          await page.getByText(step.text!, { exact: false }).first().waitFor({ timeout: 10000 });
          return { action: step.action, success: true };

        case 'extractText': {
          const el = page.locator(step.selector!).first();
          const text = await el.innerText({ timeout: 10000 });
          return { action: step.action, success: true, data: text };
        }

        case 'snapshotText': {
          const bodyText = await page.locator('body').innerText({ timeout: 10000 });
          return { action: step.action, success: true, data: bodyText };
        }

        case 'screenshot': {
          const safeName = path.basename(step.name!).replace(/[^a-zA-Z0-9_.-]/g, '_');
          const screenshotPath = path.join(os.tmpdir(), `${safeName}.png`);
          await page.screenshot({ path: screenshotPath, timeout: 10000 });
          return { action: step.action, success: true, data: screenshotPath };
        }

        case 'closeBrowser':
          return { action: step.action, success: true };

        default:
          return {
            action: step.action,
            success: false,
            error: `Unknown action: ${step.action}`,
          };
      }
    } catch (err) {
      return {
        action: step.action,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
