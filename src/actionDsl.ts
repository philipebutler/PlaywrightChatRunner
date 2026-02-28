export const AVAILABLE_TOOLS = [
  'goto',
  'clickText',
  'type',
  'waitForText',
  'extractText',
  'snapshotText',
  'screenshot',
  'closeBrowser',
] as const;

export interface ActionStep {
  action: string;
  url?: string;
  text?: string;
  selector?: string;
  value?: string;
  name?: string;
}

export interface ActionPlan {
  steps: ActionStep[];
}

function validateStep(step: unknown, index: number, enabledTools: string[]): string[] {
  const errors: string[] = [];
  if (typeof step !== 'object' || step === null) {
    return [`Step ${index}: must be an object`];
  }
  const s = step as Record<string, unknown>;
  if (typeof s.action !== 'string') {
    errors.push(`Step ${index}: "action" must be a string`);
    return errors;
  }
  const action = s.action;
  if (!enabledTools.includes(action)) {
    errors.push(`Step ${index}: action "${action}" is not in the enabled tools list`);
    return errors;
  }
  switch (action) {
    case 'goto':
      if (typeof s.url !== 'string' || !s.url) {
        errors.push(`Step ${index}: "goto" requires a non-empty "url" string`);
      }
      break;
    case 'clickText':
      if (typeof s.text !== 'string' || !s.text) {
        errors.push(`Step ${index}: "clickText" requires a non-empty "text" string`);
      }
      break;
    case 'type':
      if (typeof s.selector !== 'string' || !s.selector) {
        errors.push(`Step ${index}: "type" requires a non-empty "selector" string`);
      }
      if (typeof s.value !== 'string') {
        errors.push(`Step ${index}: "type" requires a "value" string`);
      }
      break;
    case 'waitForText':
      if (typeof s.text !== 'string' || !s.text) {
        errors.push(`Step ${index}: "waitForText" requires a non-empty "text" string`);
      }
      break;
    case 'extractText':
      if (typeof s.selector !== 'string' || !s.selector) {
        errors.push(`Step ${index}: "extractText" requires a non-empty "selector" string`);
      }
      break;
    case 'snapshotText':
    case 'closeBrowser':
      // no extra fields required
      break;
    case 'screenshot':
      if (typeof s.name !== 'string' || !s.name) {
        errors.push(`Step ${index}: "screenshot" requires a non-empty "name" string`);
      }
      break;
    default:
      errors.push(`Step ${index}: unknown action "${action}"`);
  }
  return errors;
}

export function validateActionPlan(
  raw: unknown,
  enabledTools: string[]
): { valid: boolean; errors: string[]; plan?: ActionPlan } {
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, errors: ['Plan must be a JSON object'] };
  }

  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.steps)) {
    return { valid: false, errors: ['"steps" must be an array'] };
  }

  for (let i = 0; i < obj.steps.length; i++) {
    const stepErrors = validateStep(obj.steps[i], i, enabledTools);
    errors.push(...stepErrors);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const plan: ActionPlan = { steps: obj.steps as ActionStep[] };
  return { valid: true, errors: [], plan };
}
