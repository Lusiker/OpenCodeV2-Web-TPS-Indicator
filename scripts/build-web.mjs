import { execFileSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const source = join(root, "web/tps-meter.user.js")
const target = join(root, "web/extension/content.js")
const archive = join(root, "web/tps-meter-extension.zip")

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const manifest = JSON.parse(
  readFileSync(join(root, "web/extension/manifest.json"), "utf8"),
)
const script = readFileSync(source, "utf8")
const header = script.match(/@version\s+(\S+)/)?.[1]

const versions = {
  "package.json": pkg.version,
  "tps-meter.user.js": header,
  "manifest.json": manifest.version,
}

const unique = new Set(Object.values(versions))
if (unique.size !== 1) {
  console.error("version mismatch:")
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version ?? "missing"}`)
  }
  process.exit(1)
}

copyFileSync(source, target)
const { atime, mtime } = statSync(source)
utimesSync(target, atime, mtime)
console.log(`synced web/extension/content.js (${statSync(target).size} bytes)`)

rmSync(archive, { force: true })
try {
  execFileSync("zip", ["-r", "-q", "-X", "-D", "tps-meter-extension.zip", "extension"], {
    cwd: join(root, "web"),
    stdio: "inherit",
  })
} catch {
  console.error("zip is not available; install it or pack web/extension manually")
  process.exit(1)
}

if (!existsSync(archive)) {
  console.error("archive was not created")
  process.exit(1)
}

console.log(`packed web/tps-meter-extension.zip (${statSync(archive).size} bytes)`)
