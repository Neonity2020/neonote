/**
 * electron-builder `afterPack` hook for macOS.
 *
 * Guarantees the packaged .app ends up with a valid, sealed code signature.
 * Apple Silicon (arm64) refuses to launch a bundle that is not signed, and an
 * unsealed bundle is reported by Gatekeeper as "damaged", so an unsigned build
 * is not distributable.
 *
 * - A real Developer ID signature is left untouched, so a release build made
 *   with a real certificate is never downgraded to an ad-hoc signature.
 * - Otherwise the bundle is signed ad-hoc with the entitlements Electron needs
 *   for its JIT-compiled renderer.
 *
 * `afterPack` is used rather than `afterSign` because `afterSign` is only
 * emitted when electron-builder itself managed to sign, which is exactly the
 * case we need to cover.
 */
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

function codesign(args) {
  return execFileSync('codesign', args, { stdio: 'pipe', encoding: 'utf8' })
}

/** True when the bundle already carries a genuine Developer ID signature. */
function hasDeveloperIdSignature(appPath) {
  let info
  try {
    info = codesign(['-dv', '--verbose=2', appPath])
  } catch {
    return false
  }
  const signature = /Signature=(.+)/.exec(info)?.[1]?.trim()
  const team = /TeamIdentifier=(.+)/.exec(info)?.[1]?.trim()
  return Boolean(signature && signature !== 'adhoc' && team && team !== 'not set')
}

/** Resolve the .app bundle name from the packager context. */
function resolveAppPath(context) {
  const appInfo = context?.packager?.appInfo
  const productName = appInfo?.productFilename || appInfo?.productName
  if (!productName) return null
  return path.join(context.appOutDir, `${productName}.app`)
}

module.exports = async function signMac(context) {
  if (context?.electronPlatformName !== 'darwin') {
    return
  }

  const appPath = resolveAppPath(context)
  if (!appPath) {
    console.log('  • code signing skipped, unable to resolve the .app bundle name')
    return
  }
  if (!existsSync(appPath)) {
    console.log(`  • code signing skipped, no app bundle at ${appPath}`)
    return
  }

  if (hasDeveloperIdSignature(appPath)) {
    console.log('  • code signing skipped, a Developer ID signature is already present')
    return
  }

  const entitlements = path.join(ROOT, 'build', 'entitlements.mac.plist')
  const args = ['--deep', '--force', '--sign', '-', '--timestamp=none']
  if (existsSync(entitlements)) {
    args.push('--entitlements', entitlements)
  }
  args.push(appPath)

  codesign(args)
  codesign(['--verify', '--deep', '--strict', appPath])
  console.log(`  • ad-hoc signed ${path.basename(appPath)}`)
}

module.exports.default = module.exports
