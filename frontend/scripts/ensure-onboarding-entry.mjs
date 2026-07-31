import { copyFile, readdir, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url))
const projectRoot = resolve(scriptDirectory, "..")
const buildRoot = resolve(projectRoot, "build")
const sourceEntry = resolve(projectRoot, "public", "onboarding.html")

const candidates = await readdir(buildRoot, { withFileTypes: true })
const extensionBuilds = candidates.filter(
  (entry) =>
    entry.isDirectory() &&
    /^(chrome|edge|firefox|gecko)-mv[23]-(prod|dev)$/.test(entry.name)
)

if (extensionBuilds.length === 0) {
  throw new Error("No Plasmo extension build directory was found.")
}

const buildCandidates = await Promise.all(
  extensionBuilds.map(async (entry) => {
    const outputRoot = resolve(buildRoot, entry.name)
    const manifest = await stat(resolve(outputRoot, "manifest.json")).catch(
      () => null
    )
    return { outputRoot, modifiedAt: manifest?.mtimeMs ?? 0 }
  })
)
const latestBuild = buildCandidates.sort(
  (left, right) => right.modifiedAt - left.modifiedAt
)[0]

if (!latestBuild || latestBuild.modifiedAt === 0) {
  throw new Error("No completed Plasmo extension build was found.")
}

const generatedPage = resolve(
  latestBuild.outputRoot,
  "tabs",
  "onboarding.html"
)
try {
  await stat(generatedPage)
} catch {
  throw new Error(
    "The onboarding page was not generated; refusing to publish an incomplete extension."
  )
}

await copyFile(
  sourceEntry,
  resolve(latestBuild.outputRoot, "onboarding.html")
)
console.log(`Verified onboarding.html in ${latestBuild.outputRoot}.`)
