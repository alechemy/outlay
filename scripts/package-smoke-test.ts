import { execSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const keepTemp = process.argv.includes("--keep-temp");
const tempRoot = await mkdtemp(path.join(tmpdir(), "constraint-layout-smoke-"));
let succeeded = false;

try {
  const tarballPath = await packPackage();
  await smokeJavaScriptEsm(tarballPath);
  await smokeTypeScript(tarballPath);
  succeeded = true;
  console.log(`Package smoke test passed: ${tarballPath}`);
} catch (error) {
  console.error(`Package smoke test failed. Temp files kept at ${tempRoot}`);
  throw error;
} finally {
  if (!keepTemp && succeeded) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function packPackage(): Promise<string> {
  const packDir = path.join(tempRoot, "pack");
  await mkdir(packDir, { recursive: true });

  execSync(`npm pack --pack-destination ${packDir}`, {
    cwd: root,
    stdio: "inherit",
  });

  const entries = await readdir(packDir);
  const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(
      `Expected exactly one tarball in ${packDir}, found ${tarballs.length}`,
    );
  }
  return path.join(packDir, tarballs[0]!);
}

async function smokeJavaScriptEsm(tarballPath: string): Promise<void> {
  const projectDir = path.join(tempRoot, "js-esm");
  await createProject(projectDir, {
    name: "constraint-layout-smoke-js-esm",
    private: true,
    type: "module",
  });

  await installTarball(projectDir, tarballPath);
  await writeFile(
    path.join(projectDir, "index.js"),
    [
      "import { solveLayout } from 'outlay';",
      "",
      "const root = {",
      "  id: 'root',",
      "  width: 300,",
      "  height: 100,",
      "  display: 'flex',",
      "  flexDirection: 'row',",
      "  boxSizing: 'border-box',",
      "  padding: { top: 0, right: 0, bottom: 0, left: 0 },",
      "  margin: { top: 0, right: 0, bottom: 0, left: 0 },",
      "  border: { top: 0, right: 0, bottom: 0, left: 0 },",
      "  children: [",
      "    {",
      "      id: 'a',",
      "      display: 'block',",
      "      flexGrow: 1,",
      "      boxSizing: 'border-box',",
      "      padding: { top: 0, right: 0, bottom: 0, left: 0 },",
      "      margin: { top: 0, right: 0, bottom: 0, left: 0 },",
      "      border: { top: 0, right: 0, bottom: 0, left: 0 },",
      "      children: [],",
      "    },",
      "    {",
      "      id: 'b',",
      "      display: 'block',",
      "      flexGrow: 1,",
      "      boxSizing: 'border-box',",
      "      padding: { top: 0, right: 0, bottom: 0, left: 0 },",
      "      margin: { top: 0, right: 0, bottom: 0, left: 0 },",
      "      border: { top: 0, right: 0, bottom: 0, left: 0 },",
      "      children: [],",
      "    },",
      "  ],",
      "};",
      "",
      "const result = solveLayout(root);",
      "const boxA = result.boxes.get('a');",
      "const boxB = result.boxes.get('b');",
      "",
      "if (!boxA || !boxB) throw new Error('Missing boxes');",
      "if (boxA.width !== 150) throw new Error(`Expected a.width=150, got ${boxA.width}`);",
      "if (boxB.width !== 150) throw new Error(`Expected b.width=150, got ${boxB.width}`);",
      "if (boxB.x !== 150) throw new Error(`Expected b.x=150, got ${boxB.x}`);",
      "",
      "console.log('js-esm ok');",
      "",
    ].join("\n"),
  );

  execSync("node index.js", {
    cwd: projectDir,
    stdio: "inherit",
  });
}

async function smokeTypeScript(tarballPath: string): Promise<void> {
  const projectDir = path.join(tempRoot, "ts");
  await createProject(projectDir, {
    name: "constraint-layout-smoke-ts",
    private: true,
    type: "module",
  });

  await installTarball(projectDir, tarballPath);
  await writeFile(
    path.join(projectDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "esnext",
          module: "nodenext",
          moduleResolution: "nodenext",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["index.ts"],
      },
      null,
      2,
    ) + "\n",
  );

  await writeFile(
    path.join(projectDir, "index.ts"),
    [
      "import { solveLayout } from 'outlay';",
      "import type { LayoutNode, LayoutResult, ResolvedBox, BoxSides } from 'outlay';",
      "",
      "const sides: BoxSides = { top: 0, right: 0, bottom: 0, left: 0 };",
      "const root: LayoutNode = {",
      "  id: 'root',",
      "  width: 300,",
      "  height: 100,",
      "  display: 'flex',",
      "  boxSizing: 'border-box',",
      "  padding: sides,",
      "  margin: sides,",
      "  border: sides,",
      "  children: [],",
      "};",
      "",
      "const result: LayoutResult = solveLayout(root);",
      "const box: ResolvedBox | undefined = result.boxes.get('root');",
      "box!.width satisfies number;",
      "",
    ].join("\n"),
  );

  const tscPath = path.join(root, "node_modules", ".bin", "tsc");
  execSync(`${tscPath} -p tsconfig.json`, {
    cwd: projectDir,
    stdio: "inherit",
  });

  console.log("ts ok");
}

async function createProject(
  dir: string,
  pkg: Record<string, unknown>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n",
  );
}

async function installTarball(
  projectDir: string,
  tarballPath: string,
): Promise<void> {
  execSync(`npm install --ignore-scripts --no-package-lock ${tarballPath}`, {
    cwd: projectDir,
    stdio: "inherit",
  });
}
