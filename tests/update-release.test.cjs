const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateMacRelease } = require('../scripts/check-mac-release.cjs');
const { build } = require('../package.json');
test('release configuration keeps supported targets and fixed public updater metadata', () => {
  assert.deepEqual(build.mac.target, ['dmg', 'zip']);
  assert.deepEqual(build.linux.target, ['AppImage']);
  assert.deepEqual(build.win.target, ['nsis']);
  assert.deepEqual(build.publish, { provider: 'github', owner: 'BrUn3y', repo: 'xTerm', releaseType: 'release' });
  assert.equal(build.mac.notarize, true); assert.equal(build.mac.hardenedRuntime, true);
  assert.ok(build.artifactName.includes('${arch}'));
  assert.equal('token' in build.publish, false);
});
test('protected macOS release preflight rejects missing, disabled and ad-hoc signing', () => {
  const env = { CSC_NAME: 'Developer ID Application: Test', APPLE_KEYCHAIN: 'test.keychain', APPLE_KEYCHAIN_PROFILE: 'notary' };
  assert.doesNotThrow(() => validateMacRelease('darwin', env));
  for (const input of [{}, { ...env, CSC_NAME: '-' }, { ...env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, { CSC_NAME: env.CSC_NAME }]) {
    assert.throws(() => validateMacRelease('darwin', input));
  }
  assert.throws(() => validateMacRelease('linux', env), /macOS runner/);
});
