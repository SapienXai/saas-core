import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const sourceRoot = path.join(root, "components/ui")
const packageRoot = path.join(root, "packages/ui/src/components/ui")
const files = (await readdir(sourceRoot)).filter((file) => file.endsWith(".tsx")).sort()
const normalized = (value, file) => {
  let result = value
    .replaceAll('from "../../lib/utils"', 'from "@/lib/utils"')
    .replaceAll('from "../../context/language-context"', 'from "@/context/language-context"')
    .replaceAll('from "../../hooks/use-mobile"', 'from "@/hooks/use-mobile"')
    .replaceAll('from "../../hooks/use-toast"', 'from "@/hooks/use-toast"')
    .replaceAll('from "../theme-provider"', 'from "@/components/theme-provider"')
  result = result.replace(/from "\.\/([^"/]+)"/g, 'from "@/components/ui/$1"')
  return file === "menubar.tsx" ? result.replace("const MenubarMenu: typeof MenubarPrimitive.Menu = MenubarPrimitive.Menu", "const MenubarMenu = MenubarPrimitive.Menu") : result
}
const mismatches = []
for (const file of files) {
  const source = await readFile(path.join(sourceRoot, file), "utf8")
  const packaged = await readFile(path.join(packageRoot, file), "utf8")
  if (normalized(source, file) !== normalized(packaged, file)) mismatches.push(file)
}
if (mismatches.length) throw new Error(`UI source fidelity mismatch: ${mismatches.join(", ")}`)
console.log(`UI source fidelity verified: ${files.length} primitives preserved with only the documented package type annotation.`)
