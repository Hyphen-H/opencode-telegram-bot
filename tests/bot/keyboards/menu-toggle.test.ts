import { describe, expect, it, vi, beforeEach } from "vitest";
const setCollapsed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../../src/app/stores/settings-store.js", () => ({
  setMainMenuCollapsed: setCollapsed,
}));
import { registerMenuToggle } from "../../../src/bot/keyboards/menu-toggle.js";
import { defined } from "../../helpers/defined.js";

describe("menu toggle", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("silently updates the keyboard and removes carrier and button messages", async () => {
    const { ctx, hide, keyboard } = setup();
    await hide(ctx);
    expect(setCollapsed).toHaveBeenCalledWith(true);
    expect(ctx.reply).toHaveBeenCalledExactlyOnceWith("\u2063", {
      disable_notification: true,
      reply_markup: keyboard,
    });
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(42, 100);
    expect(ctx.deleteMessage).toHaveBeenCalledOnce();
  });

  it("restores the menu with its button or /menu", async () => {
    const { ctx, show, menu } = setup();
    await show(ctx);
    await menu(ctx);
    expect(setCollapsed.mock.calls).toEqual([[false], [false]]);
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
