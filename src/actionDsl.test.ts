import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { validateActionPlan, AVAILABLE_TOOLS } from './actionDsl';

describe('validateActionPlan', () => {
  const allTools = [...AVAILABLE_TOOLS];

  it('accepts a valid goto step', () => {
    const result = validateActionPlan(
      { steps: [{ action: 'goto', url: 'https://example.com' }] },
      allTools
    );
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.plan);
    assert.equal(result.plan.steps.length, 1);
  });

  it('rejects non-object input', () => {
    const result = validateActionPlan('not an object', allTools);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('rejects missing steps array', () => {
    const result = validateActionPlan({ noSteps: true }, allTools);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('"steps"')));
  });

  it('rejects step without action string', () => {
    const result = validateActionPlan({ steps: [{ url: 'https://x.com' }] }, allTools);
    assert.equal(result.valid, false);
  });

  it('rejects goto without url', () => {
    const result = validateActionPlan({ steps: [{ action: 'goto' }] }, allTools);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('url')));
  });

  it('rejects clickText without text', () => {
    const result = validateActionPlan({ steps: [{ action: 'clickText' }] }, allTools);
    assert.equal(result.valid, false);
  });

  it('rejects type without selector', () => {
    const result = validateActionPlan(
      { steps: [{ action: 'type', value: 'hello' }] },
      allTools
    );
    assert.equal(result.valid, false);
  });

  it('rejects type without value', () => {
    const result = validateActionPlan(
      { steps: [{ action: 'type', selector: '#input' }] },
      allTools
    );
    assert.equal(result.valid, false);
  });

  it('rejects screenshot without name', () => {
    const result = validateActionPlan({ steps: [{ action: 'screenshot' }] }, allTools);
    assert.equal(result.valid, false);
  });

  it('accepts closeBrowser with no extra fields', () => {
    const result = validateActionPlan({ steps: [{ action: 'closeBrowser' }] }, allTools);
    assert.equal(result.valid, true);
  });

  it('accepts snapshotText with no extra fields', () => {
    const result = validateActionPlan({ steps: [{ action: 'snapshotText' }] }, allTools);
    assert.equal(result.valid, true);
  });

  it('rejects unknown actions', () => {
    const result = validateActionPlan(
      { steps: [{ action: 'deleteEverything' }] },
      allTools
    );
    assert.equal(result.valid, false);
  });

  it('rejects disabled tools', () => {
    const result = validateActionPlan(
      { steps: [{ action: 'goto', url: 'https://example.com' }] },
      ['clickText'] // only clickText enabled
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('not in the enabled tools list')));
  });

  it('rejects all actions when no tools are enabled', () => {
    const result = validateActionPlan(
      { steps: [{ action: 'goto', url: 'https://example.com' }] },
      [] // no tools enabled
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('not in the enabled tools list')));
  });

  it('validates multiple steps and collects all errors', () => {
    const result = validateActionPlan(
      {
        steps: [
          { action: 'goto' }, // missing url
          { action: 'type', selector: '#x' }, // missing value
        ],
      },
      allTools
    );
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 2);
  });

  it('accepts a valid multi-step plan', () => {
    const result = validateActionPlan(
      {
        steps: [
          { action: 'goto', url: 'https://example.com' },
          { action: 'clickText', text: 'About' },
          { action: 'screenshot', name: 'about-page' },
          { action: 'closeBrowser' },
        ],
      },
      allTools
    );
    assert.equal(result.valid, true);
    assert.equal(result.plan!.steps.length, 4);
  });
});
