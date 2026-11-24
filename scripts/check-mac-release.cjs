function validateMacRelease(platform, env) {
  if (platform !== 'darwin') throw new Error('Signed macOS release builds require a macOS runner.');
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') throw new Error('Signing identity discovery must not be disabled for release builds.');
  if (!env.CSC_LINK && !env.CSC_NAME) throw new Error('Configure a Developer ID Application identity using protected release credentials.');
  if (env.CSC_NAME === '-') throw new Error('Ad-hoc signatures are not accepted for update releases.');
  if (env.CSC_LINK && !env.CSC_KEY_PASSWORD) throw new Error('The signing certificate password must be configured.');
  const apiKey = env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER;
  const appleId = env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID;
  const profile = env.APPLE_KEYCHAIN && env.APPLE_KEYCHAIN_PROFILE;
  if (!apiKey && !appleId && !profile) throw new Error('Configure a protected Apple notarization credential set.');
}
if (require.main === module) {
  try { validateMacRelease(process.platform, process.env); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validateMacRelease };
