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
      "import { parseHTML } from 'outlay/html';",
      "import { measureFromAdvances, textNode } from 'outlay/text';",
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
      "if (result.contentSize.width !== 300) throw new Error('bad contentSize');",
      "",
      "const parsed = solveLayout(parseHTML(",
      "  '<div style=\"display: flex; width: 200px; height: 50px\"><div id=\"kid\" style=\"flex: 1\"></div></div>',",
      "));",
      "if (parsed.boxes.get('kid').width !== 200) throw new Error('bad parseHTML solve');",
      "",
      "const label = textNode(",
      "  measureFromAdvances([40, 40], { spaceWidth: 10, lineHeight: 20 }),",
      "  { id: 'label' },",
      ");",
      "const t = solveLayout({ id: 'r', width: 60, height: 100, alignItems: 'flex-start', children: [label] });",
      "if (t.boxes.get('label').height !== 40) throw new Error('bad text wrap');",
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
      "import { solveLayout, relativeTo, hitTest } from 'outlay';",
      "import type { LayoutNode, LayoutResult, ResolvedBox, BoxSides } from 'outlay';",
      "import { parseHTML, HTMLParseError } from 'outlay/html';",
      "import { measureFromAdvances, type MeasureContent } from 'outlay/text';",
      "import { sweep, assertNoOverlaps, overflowsX, overflowsY } from 'outlay/testing';",
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
      "result.contentSize.height satisfies number;",
      "result.nodes.get(root)?.baseline satisfies number | undefined;",
      "",
      "const parsed: LayoutNode = parseHTML('<div style=\"width: 10px; height: 10px\"></div>');",
      "parsed.id satisfies string | undefined;",
      "HTMLParseError satisfies new (...args: never[]) => Error;",
      "const m: MeasureContent = measureFromAdvances([1], { spaceWidth: 1, lineHeight: 10 });",
      "m(100).width satisfies number;",
      "",
      "relativeTo(result, 'root') satisfies { x: number; y: number };",
      "hitTest(result, 0, 0) satisfies ResolvedBox | undefined;",
      "const failures = sweep([100, 200], (w: number): LayoutNode => ({ id: 'r', width: w, height: 10, children: [] }), (r: LayoutResult) => assertNoOverlaps(r));",
      "failures satisfies { width: number; error: Error }[];",
      "overflowsX(result, 'root') satisfies boolean;",
      "overflowsY(result, 'root') satisfies boolean;",
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
