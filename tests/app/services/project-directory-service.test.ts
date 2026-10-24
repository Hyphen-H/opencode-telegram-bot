import { mkdtemp, mkdir, realpath, rm, symlink, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initBrowserRoots,
  getHomeDirectory,
} from "../../../src/app/services/file-browser-service.js";
import {
  createProjectDirectory,
  inspectProjectDirectory,
  resolveProjectDirectoryInput,
} from "../../../src/app/services/project-directory-service.js";

describe("project directories", () => {
  let temporary: string;
  let root: string;
  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "bot-project-directory-"));
    root = path.join(await realpath(temporary), "allowed");
    await mkdir(root);
    initBrowserRoots(root);
  });
  afterEach(async () => {
    initBrowserRoots();
    await rm(temporary, { recursive: true, force: true });
  });

  it("resolves relative and absolute paths without interpreting shell syntax", () => {
    expect(resolveProjectDirectoryInput("new project", root)).toBe(path.join(root, "new project"));
    expect(resolveProjectDirectoryInput(root, root)).toBe(root);
    expect(resolveProjectDirectoryInput("$(touch file)", root)).toBe(
      path.join(root, "$(touch file)"),
    );
  });
  it("expands home paths", () => {
    initBrowserRoots(getHomeDirectory());
    expect(resolveProjectDirectoryInput("~/projects/new", root)).toBe(
      path.join(getHomeDirectory(), "projects/new"),
    );
    expect(resolveProjectDirectoryInput("~", root)).toBe(getHomeDirectory());
  });
  it.each(["", "..", "../outside", "nested/folder", "nested\\folder", "a\0b"])(
    "rejects invalid folder names: %s",
    (name) => {
      expect(() => resolveProjectDirectoryInput(name, root, true)).toThrow();
    },
  );
  it("rejects traversal and sibling prefix escapes", () => {
    expect(() => resolveProjectDirectoryInput("../outside", root)).toThrow();
    expect(() => resolveProjectDirectoryInput(root + "-other", root)).toThrow();
  });
  it("creates nested directories only when explicitly invoked and preserves existing files", async () => {
    const target = path.join(root, "new", "nested");
    expect(await inspectProjectDirectory(target)).toBe("missing");
    await createProjectDirectory(target);
    expect(await inspectProjectDirectory(target)).toBe("exists");
    const file = path.join(root, "existing");
    await writeFile(file, "keep");
    await expect(createProjectDirectory(file)).rejects.toThrow();
    expect((await stat(file)).isFile()).toBe(true);
  });
  it.skipIf(process.platform === "win32")(
    "rejects missing descendants of an escaping symlink",
    async () => {
      const outside = path.join(temporary, "outside");
      await mkdir(outside);
      await symlink(outside, path.join(root, "escape"));
      await expect(createProjectDirectory(path.join(root, "escape", "new"))).rejects.toThrow();
      await expect(stat(path.join(outside, "new"))).rejects.toThrow();
    },
  );
});
