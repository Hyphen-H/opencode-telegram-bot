import { describe, expect, it, vi, beforeEach } from "vitest";
const setCollapsed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../../src/app/stores/settings-store.js", () => ({
  setMainMenuCollapsed: setCollapsed,
  getCurrentSession: getSession,
}));
import { registerMenuToggle } from "../../../src/bot/keyboards/menu-toggle.js";
import { defined } from "../../helpers/defined.js";

describe("menu toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockReturnValue({ title: "Current task" });
  });

  function setup() {
    const bot = { hears: vi.fn(), command: vi.fn() };
    const keyboard = { keyboard: [[{ text: "menu" }]] };
    const manager = { initialize: vi.fn(), getKeyboard: vi.fn().mockReturnValue(keyboard) };
    registerMenuToggle(bot as never, { keyboardManager: manager });
    const ctx = {
      chat: { id: 42 },
      api: { deleteMessage: vi.fn().mockResolvedValue(true) },
      reply: vi.fn().mockResolvedValue({ message_id: 100 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    };
    const hide = defined(bot.hears.mock.calls[0]?.[1]) as (ctx: unknown) => Promise<void>;
    const show = defined(bot.hears.mock.calls[1]?.[1]) as (ctx: unknown) => Promise<void>;
    const menu = defined(bot.command.mock.calls[0]?.[1]) as (ctx: unknown) => Promise<void>;
    return { ctx, hide, show, menu, keyboard };
  }

  it("silently updates the keyboard and retains its latest carrier", async () => {
    const { ctx, hide, keyboard } = setup();
    await hide(ctx);
    expect(setCollapsed).toHaveBeenCalledWith(true);
    expect(ctx.reply).toHaveBeenCalledExactlyOnceWith("💬 Current task", {
      disable_notification: true,
      reply_markup: keyboard,
    });
    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.deleteMessage).toHaveBeenCalledOnce();
  });

  it("offers session selection instead of an empty bubble when no session is selected", async () => {
    const { ctx, menu } = setup();
    getSession.mockReturnValue(undefined);
    await menu(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("session"), expect.anything());
  });

  it("restores the menu with its button or /menu", async () => {
    const { ctx, show, menu } = setup();
    await show(ctx);
    await menu(ctx);
    expect(setCollapsed.mock.calls).toEqual([[false], [false]]);
  });

  it("does not delete /menu or its keyboard carrier", async () => {
    const { ctx, menu } = setup();
    await menu(ctx);
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
  });

  it("removes only the old carrier after the next keyboard is accepted", async () => {
    const { ctx, hide, show } = setup();
    ctx.reply.mockResolvedValueOnce({ message_id: 100 }).mockResolvedValueOnce({ message_id: 101 });
    await hide(ctx);
    await show(ctx);
    expect(ctx.api.deleteMessage).toHaveBeenCalledExactlyOnceWith(42, 100);
    expect(ctx.api.deleteMessage).not.toHaveBeenCalledWith(42, 101);
  });

  it("does not fall through or send another status reply when cleanup is forbidden", async () => {
    const { ctx, hide } = setup();
    ctx.api.deleteMessage.mockRejectedValue(new Error("forbidden"));
    ctx.deleteMessage.mockRejectedValue(new Error("forbidden"));
    await expect(hide(ctx)).resolves.toBeUndefined();
    expect(ctx.reply).toHaveBeenCalledOnce();
    expect(ctx.deleteMessage).toHaveBeenCalledOnce();
  });

  it("handles a failed keyboard send without forwarding the button as a prompt", async () => {
    const { ctx, hide } = setup();
    ctx.reply.mockRejectedValue(new Error("offline"));
    await expect(hide(ctx)).resolves.toBeUndefined();
    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });
});
