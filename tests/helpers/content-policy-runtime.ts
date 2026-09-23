import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(path.resolve("package.json"));

export function policyRuntime(dependencies: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>();
  const logs: unknown[] = [];
  function modulePath(base: string) {
    if (existsSync(`${base}.ts`)) return `${base}.ts`;
    if (existsSync(`${base}.tsx`)) return `${base}.tsx`;
    return path.join(base, "index.ts");
  }
  function load<T>(file: string): T {
    const absolute = path.resolve(file);
    if (cache.has(absolute)) return cache.get(absolute) as T;
    const commonJs = { exports: {} };
    cache.set(absolute, commonJs.exports);
    const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    runInNewContext(code, {
      module: commonJs, exports: commonJs.exports, Request, Response, Headers, URL, Error, AggregateError, FormData, File, Blob, TextDecoder, TextEncoder, performance, AbortSignal, Uint8Array, Buffer,
      console: { error: (...args: unknown[]) => logs.push(args) },
      fetch: () => { throw new Error("Live network forbidden in content-policy tests"); },
      ...globals,
      require: (name: string) => {
        if (name === "server-only") return {};
        if (name in dependencies) return dependencies[name];
        if (name.startsWith("@/")) return load(modulePath(path.resolve("src", ...name.slice(2).split("/"))));
        if (name.startsWith(".")) return name.endsWith(".mjs")
          ? nativeRequire(path.resolve(path.dirname(absolute), name))
          : load(modulePath(path.resolve(path.dirname(absolute), name)));
        return nativeRequire(name);
      },
    });
    return commonJs.exports as T;
  }
  return { load, logs };
}
