import type { GlobalSession } from "@opencode-ai/sdk/v2";
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ list: vi.fn(), excluded: [] as string[] }));
vi.mock("../../../src/opencode/client.js", () => ({
  opencodeServerVersion: "v2",
  opencodeClient: {},
  opencodeV2Client: { session: { listGlobalRoots: mocked.list } },
}));
vi.mock("../../../src/config.js", () => ({
  config: { bot: { excludedProjectPaths: mocked.excluded } },
}));
import {
  getTemporarySessionsDirectory,
  isTemporarySessionDirectory,
  loadTemporarySessions,
  syncTemporarySessionLinks,
} from "../../../src/app/services/temporary-sessions-service.js";

describe("temporary sessions", () => {
  let temporary: string;
  let chat: string;
  const session = (id: string, directory: string, updated = 1): GlobalSession => ({
    id,
    slug: id,
    projectID: "global",
    directory,
    title: `Title ${id}`,
    version: "v2",
    time: { created: 1, updated },
    project: null,
  });
  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "bot-temp-sessions-"));
    vi.stubEnv("XDG_CONFIG_HOME", path.join(temporary, "config"));
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", path.join(temporary, "bot"));
    chat = path.join(temporary, "config", "openchamber", "chats", "2026-10-24", "session-abc");
    await mkdir(chat, { recursive: true });
    mocked.list.mockReset();
    mocked.excluded.length = 0;
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(temporary, { recursive: true, force: true });
  });
  it("recognizes only OpenChamber's exact date/session directory layout", () => {
    expect(isTemporarySessionDirectory(chat)).toBe(true);
    for (const directory of [
      chat + "-extra/child",
      path.dirname(chat),
      path.join(temporary, "repo"),
      chat.replace("2026-10-24", "other"),
    ]) {
      expect(isTemporarySessionDirectory(directory)).toBe(false);
    }
  });
  it("preserves titles, filters ordinary projects and children, deduplicates and sorts", async () => {
    const a = session("ses_a", chat, 10);
    const b = session("ses_b", chat, 20);
    mocked.list.mockResolvedValue({
      data: [
        a,
        b,
        a,
        session("ses_normal", temporary),
        { ...a, id: "ses_child", parentID: "ses_a" },
      ],
      error: undefined,
    });
    expect(await loadTemporarySessions()).toEqual([b, a]);
    mocked.excluded.push(chat);
    expect(await loadTemporarySessions()).toEqual([]);
  });
  it("propagates API failures instead of pretending the group is empty", async () => {
    mocked.list.mockResolvedValue({ data: undefined, error: new Error("offline") });
    await expect(loadTemporarySessions()).rejects.toThrow("offline");
  });
  it("indexes originals by stable session IDs without moving or changing their contents", async () => {
    await writeFile(path.join(chat, "keep.txt"), "original");
    const sessions = [session("ses_a", chat), session("ses_b", chat)];
    await syncTemporarySessionLinks(sessions);
    await syncTemporarySessionLinks(sessions);
    expect(await readlink(path.join(getTemporarySessionsDirectory(), "ses_a"))).toBe(chat);
    expect(await readlink(path.join(getTemporarySessionsDirectory(), "ses_b"))).toBe(chat);
    expect(await readFile(path.join(chat, "keep.txt"), "utf8")).toBe("original");
  });
  it("does not overwrite a pre-existing index file or use an unsafe session ID", async () => {
    await mkdir(getTemporarySessionsDirectory(), { recursive: true });
    const existing = path.join(getTemporarySessionsDirectory(), "ses_a");
    await writeFile(existing, "user file");
    await syncTemporarySessionLinks([session("ses_a", chat), session("../outside", chat)]);
    expect(await readFile(existing, "utf8")).toBe("user file");
  });
});
