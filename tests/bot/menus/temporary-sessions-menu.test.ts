import type { GlobalSession } from "@opencode-ai/sdk/v2";
import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ load: vi.fn(), sync: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../src/app/services/temporary-sessions-service.js", async (original) => ({
  ...(await original<typeof import("../../../src/app/services/temporary-sessions-service.js")>()),
  loadTemporarySessions: mocked.load,
  syncTemporarySessionLinks: mocked.sync,
}));
import {
  showTemporarySessions,
  handleTemporarySessionsCallback,
} from "../../../src/bot/menus/temporary-sessions-menu.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import { config } from "../../../src/config.js";
import { t } from "../../../src/i18n/index.js";

describe("temporary sessions menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.sync.mockResolvedValue(undefined);
  });
  function context(data?: string): Context {
    return {
      chat: { id: 123 },
      callbackQuery: data ? { data, message: { message_id: 42 } } : undefined,
      answerCallbackQuery: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
      reply: vi.fn().mockResolvedValue({ message_id: 42 }),
    } as unknown as Context;
  }
  function sessions(count: number) {
    return Array.from(
      { length: count },
      (_, i) =>
        ({
          id: `ses_${i}`,
          title: `Actual title ${i}`,
          directory: `/original/session-${i}`,
          time: { created: 1, updated: i },
        }) as GlobalSession,
    );
  }
  it("shows real titles with paginated selection metadata pointing to original directories", async () => {
    const all = sessions(config.bot.sessionsListLimit + 1);
    mocked.load.mockResolvedValue(all);
    const deps = createTestAppContainer();
    const ctx = context();
    await showTemporarySessions(ctx, deps);
    expect(ctx.reply).toHaveBeenCalledWith(
      t("projects.temporary"),
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({
                text: expect.stringContaining("Actual title 0"),
                callback_data: "recent:0",
              }),
              expect.objectContaining({ callback_data: "session-actions:0" }),
            ]),
            [expect.objectContaining({ callback_data: "temporary:page:1" })],
          ]),
        }),
      }),
    );
    expect(deps.interactionManager.getSnapshot()?.metadata).toMatchObject({
      menuKind: "recent",
      temporarySessions: true,
      directories: all.slice(0, config.bot.sessionsListLimit).map((s) => s.directory),
    });
    const next = context("temporary:page:1");
    expect(await handleTemporarySessionsCallback(next, deps)).toBe(true);
    expect(deps.interactionManager.getSnapshot()?.metadata).toMatchObject({
      sessionIds: [all.at(-1)!.id],
      directories: [all.at(-1)!.directory],
    });
  });
  it("opens the group from projects without changing project/session until a session is selected", async () => {
    mocked.load.mockResolvedValue(sessions(1));
    const deps = createTestAppContainer();
    deps.interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: { menuKind: "project", messageId: 42 },
    });
    const ctx = context("project:temporary-sessions");
    expect(await handleTemporarySessionsCallback(ctx, deps)).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledWith(t("projects.temporary"), expect.anything());
    expect(deps.interactionManager.getSnapshot()?.metadata.menuKind).toBe("recent");
  });
  it("rejects stale or unrelated page callbacks", async () => {
    const deps = createTestAppContainer();
    const ctx = context("temporary:page:1");
    expect(await handleTemporarySessionsCallback(ctx, deps)).toBe(true);
    expect(mocked.load).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ show_alert: true }),
    );
  });
});
