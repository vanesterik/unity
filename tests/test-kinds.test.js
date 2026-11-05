const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestKinds, testKindsOf } = require('../scripts/pipeline.js');

const template = {
  test: { basePort: 4000, writablePaths: ['e2e/', 'tests/integration/', 'artifacts/'] },
  e2e: { dir: 'e2e', runCommand: 'pnpm exec playwright test' },
  integration: { dir: 'tests/integration', runCommand: '<command>' },
};

const project = {
  project: { owner: 'o', number: 3 },
  test: { basePort: 4000, start: '', writablePaths: ['e2e/', 'tests/server/', 'artifacts/'] },
  e2e: { dir: 'e2e', runCommand: 'pnpm exec playwright test' },
  integration: { dir: 'tests/server', runCommand: 'uv run pytest tests/server' },
};

test('integration keeps only the integration block, and only its directory is writable', () => {
  const config = withTestKinds(project, 'integration', template);
  assert.equal(config.e2e, undefined);
  assert.deepEqual(config.integration, project.integration);
  assert.deepEqual(config.test.writablePaths, ['tests/server/', 'artifacts/']);
  assert.deepEqual(config.project, project.project);
});

test('e2e keeps only the e2e block', () => {
  const config = withTestKinds(project, 'e2e', template);
  assert.equal(config.integration, undefined);
  assert.deepEqual(config.test.writablePaths, ['e2e/', 'artifacts/']);
});

test('both keeps both blocks, and adds a missing one from the template', () => {
  const { e2e, ...integrationOnly } = project;
  const config = withTestKinds(integrationOnly, 'both', template);
  assert.deepEqual(config.e2e, template.e2e);
  assert.deepEqual(config.integration, project.integration);
  assert.deepEqual(config.test.writablePaths, ['tests/server/', 'e2e/', 'artifacts/']);
});

test('an unknown kind is refused', () => {
  assert.throws(() => withTestKinds(project, 'unit', template), /integration, e2e or both/);
});

test('testKindsOf reads the kinds from the blocks, in a fixed order', () => {
  assert.deepEqual(testKindsOf(project), ['integration', 'e2e']);
  assert.deepEqual(testKindsOf(withTestKinds(project, 'integration', template)), ['integration']);
  assert.deepEqual(testKindsOf({}), []);
});
