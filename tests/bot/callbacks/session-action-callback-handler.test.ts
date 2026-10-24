import type { Context } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({
  get: vi.fn(),
  status: vi.fn(),
  remove: vi.fn(),
  archive: vi.fn(),
  detach: vi.fn(),
  clear: vi.fn(),
  current: undefined as { id: string } | undefined,
  version: "v2",
}));
vi.mock("../../../src/opencode/client.js", () => ({
  get opencodeServerVersion() {
    return mocked.version;
  },
  opencodeClient: { session: { get: mocked.get, status: mocked.status, delete: mocked.remove } },
  opencodeV2Client: { session: { archive: mocked.archive } },
}));
vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentSession: () => mocked.current,
}));
vi.mock("../../../src/app/services/session-service.js", () => ({ clearSession: mocked.clear }));
vi.mock("../../../src/app/services/attach-service.js", () => ({
  detachAttachedSession: mocked.detach,
}));
import { InteractionManager } from "../../../src/app/managers/interaction-manager.js";
import { handleSessionAction } from "../../../src/bot/callbacks/session-action-callback-handler.js";
import { t } from "../../../src/i18n/index.js";

describe("session management confirmations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.version = "v2";
    mocked.current = undefined;
    mocked.get.mockResolvedValue({
      data: { id: "ses_a", directory: "/original/a", title: "Real title", time: { created: 1 } },
      error: undefined,
    });
    mocked.status.mockResolvedValue({ data: {}, error: undefined });
    mocked.remove.mockResolvedValue({ data: true, error: undefined });
    mocked.archive.mockResolvedValue({ data: true, error: undefined });
  });
  function setup(kind: "recent" | "session" = "recent") {
    const manager = new InteractionManager();
    const pinClear = vi.fn().mockResolvedValue(undefined);
    const markIdle = vi.fn();
    const deps = {
      interactionManager: manager,
      attachManager: { isBusy: () => false },
      foregroundSessionState: { isBusy: () => false, markIdle },
      resetAggregator: vi.fn(),
      pinnedMessageManager: { clear: pinClear },
    } as unknown as Parameters<typeof handleSessionAction>[1];
    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: "Real title", callback_data: kind === "recent" ? "recent:0" : "session:ses_a" },
          { text: "⋯", callback_data: "session-actions:0" },
        ],
        [
          { text: "Other", callback_data: "recent:1" },
          { text: "⋯", callback_data: "session-actions:1" },
        ],
      ],
    };
    const view = { message_id: 42, text: "Sessions", reply_markup: keyboard };
    manager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: kind,
        messageId: 42,
        sessionIds: ["ses_a", "ses_b"],
        directories: ["/original/a", "/original/b"],
      },
    });
    function context(data: string, messageId = 42): Context {
      return {
        callbackQuery: { data, message: { ...view, message_id: messageId } },
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
        editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn(
          async (text: string, options: { reply_markup: InlineKeyboardMarkup }) => {
            view.text = text;
            view.reply_markup = options.reply_markup;
          },
        ),
      } as unknown as Context;
    }
    const nonce = () => (manager.getSnapshot()?.metadata.sessionAction as { nonce: string }).nonce;
    return { deps, manager, context, nonce, view, pinClear, markIdle, keyboard };
  }

  it.each(["delete", "archive"])(
    "requires explicit confirmation for %s and lets cancellation restore the list",
    async (action) => {
      const { deps, manager, context, nonce, view, keyboard } = setup();
      await handleSessionAction(context(`session-action:${action}:0`), deps);
      expect(view.text).toContain("Real title");
      expect(mocked.remove).not.toHaveBeenCalled();
      expect(mocked.archive).not.toHaveBeenCalled();
      expect(
        view.reply_markup.inline_keyboard
          .flat()
          .map((button) => "callback_data" in button && button.callback_data),
      ).toEqual([`session-action:confirm:${nonce()}`, `session-action:cancel:${nonce()}`]);
      await handleSessionAction(context(`session-action:cancel:${nonce()}`), deps);
      expect(view.text).toBe("Sessions");
      expect(view.reply_markup).toEqual(keyboard);
      expect(manager.getSnapshot()?.metadata.sessionAction).toBeUndefined();
      expect(mocked.remove).not.toHaveBeenCalled();
      expect(mocked.archive).not.toHaveBeenCalled();
    },
  );

  it.each(["recent", "session"] as const)(
    "deletes only the confirmed row in a %s list and consumes replayed confirmation",
    async (kind) => {
      const { deps, manager, context, nonce, view } = setup(kind);
      await handleSessionAction(context("session-action:delete:0"), deps);
      const confirmation = `session-action:confirm:${nonce()}`;
      await handleSessionAction(context(confirmation), deps);
      expect(mocked.remove).toHaveBeenCalledExactlyOnceWith({
        sessionID: "ses_a",
        directory: "/original/a",
      });
      expect(mocked.archive).not.toHaveBeenCalled();
      expect(view.reply_markup.inline_keyboard).toHaveLength(1);
      expect(manager.getSnapshot()?.metadata.sessionIds).toEqual([null, "ses_b"]);
      await handleSessionAction(context(confirmation), deps);
      expect(mocked.remove).toHaveBeenCalledOnce();
    },
  );

  it("archives without deleting and detaches a currently selected session", async () => {
    const { deps, context, nonce, pinClear, markIdle } = setup();
    mocked.current = { id: "ses_a" };
    await handleSessionAction(context("session-action:archive:0"), deps);
    await handleSessionAction(context(`session-action:confirm:${nonce()}`), deps);
    expect(mocked.archive).toHaveBeenCalledExactlyOnceWith({ sessionID: "ses_a" });
    expect(mocked.remove).not.toHaveBeenCalled();
    expect(mocked.detach).toHaveBeenCalledOnce();
    expect(mocked.clear).toHaveBeenCalledOnce();
    expect(pinClear).toHaveBeenCalledOnce();
    expect(markIdle).toHaveBeenCalledWith("ses_a");
  });

  it("rejects targets outside the visible page and stale menu messages", async () => {
    const { deps, context } = setup();
    await handleSessionAction(context("session-action:delete:99"), deps);
    await handleSessionAction(context("session-action:delete:0", 99), deps);
    expect(mocked.get).not.toHaveBeenCalled();
    expect(mocked.remove).not.toHaveBeenCalled();
  });

  it("rejects invalid confirmation tokens", async () => {
    const { deps, context } = setup();
    await handleSessionAction(context("session-action:delete:0"), deps);
    await handleSessionAction(context(`session-action:confirm:${"0".repeat(24)}`), deps);
    expect(mocked.remove).not.toHaveBeenCalled();
  });

  it("checks running status again at confirmation time", async () => {
    const { deps, context, nonce, manager } = setup();
    await handleSessionAction(context("session-action:delete:0"), deps);
    mocked.status.mockResolvedValue({ data: { ses_a: { type: "busy" } }, error: undefined });
    const ctx = context(`session-action:confirm:${nonce()}`);
    await handleSessionAction(ctx, deps);
    expect(mocked.remove).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("sessions.action.busy"),
      show_alert: true,
    });
    expect(manager.getSnapshot()?.metadata.sessionAction).toMatchObject({ executing: false });
  });

  it("does not mutate anything when status cannot be checked", async () => {
    const { deps, context } = setup();
    mocked.status.mockResolvedValue({ data: undefined, error: new Error("internal details") });
    const ctx = context("session-action:delete:0");
    await handleSessionAction(ctx, deps);
    expect(mocked.remove).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("sessions.action.failed"),
      show_alert: true,
    });
  });

  it("keeps a failed operation retryable without executing it automatically", async () => {
    const { deps, context, nonce, manager } = setup();
    await handleSessionAction(context("session-action:delete:0"), deps);
    const confirmation = `session-action:confirm:${nonce()}`;
    mocked.remove.mockResolvedValueOnce({ data: undefined, error: new Error("offline") });
    await handleSessionAction(context(confirmation), deps);
    expect(manager.getSnapshot()?.metadata.sessionAction).toMatchObject({ executing: false });
    await handleSessionAction(context(confirmation), deps);
    expect(mocked.remove).toHaveBeenCalledTimes(2);
    expect(manager.getSnapshot()?.metadata.sessionAction).toBeUndefined();
  });

  it("claims confirmation before awaiting the API so simultaneous taps run once", async () => {
    const { deps, context, nonce } = setup();
    await handleSessionAction(context("session-action:delete:0"), deps);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocked.remove.mockImplementation(async () => {
      await gate;
      return { data: true, error: undefined };
    });
    const confirmation = `session-action:confirm:${nonce()}`;
    const first = handleSessionAction(context(confirmation), deps);
    await vi.waitFor(() => expect(mocked.remove).toHaveBeenCalledOnce());
    await handleSessionAction(context(confirmation), deps);
    release();
    await first;
    expect(mocked.remove).toHaveBeenCalledOnce();
  });

  it("explains that archiving requires V2 without mutating a V1 session", async () => {
    const { deps, context } = setup();
    mocked.version = "v1";
    const ctx = context("session-action:archive:0");
    await handleSessionAction(ctx, deps);
    expect(mocked.archive).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("sessions.action.v2_only"),
      show_alert: true,
    });
  });
});
