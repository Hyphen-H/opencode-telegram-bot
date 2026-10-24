import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";
import { handleProjectSelect } from "../../../src/bot/callbacks/project-callback-handler.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

const mocked = vi.hoisted(() => ({
  getProjectsMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  clearAllInteractionStateMock: vi.fn(),
  switchToProjectMock: vi.fn(),
}));

vi.mock("../../../src/app/services/project-service.js", () => ({
  getProjects: mocked.getProjectsMock,
}));

vi.mock("../../../src/app/services/project-switch-service.js", () => ({
  switchToProject: mocked.switchToProjectMock,
}));

vi.mock("../../../src/bot/menus/inline-menu.js", () => ({
  appendInlineMenuCancelButton: vi.fn(),
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  replyWithInlineMenu: vi.fn(),
}));

function createCallbackContext(data: string): Context {
  return {
    callbackQuery: { data } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createDeps() {
  return {
    ...container,
    resetInteractions: mocked.clearAllInteractionStateMock,
  };
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/commands/projects handleProjectSelect", () => {
  beforeEach(() => {
    mocked.getProjectsMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockReset();
    mocked.clearAllInteractionStateMock.mockReset();
    mocked.switchToProjectMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
  });

  it("uses callback feedback and does not send chat reply on projects:page:* load error", async () => {
    const ctx = createCallbackContext("projects:page:1");
    const pageLoadError = new Error("failed to load page");
    mocked.getProjectsMock.mockRejectedValue(pageLoadError);

    const handled = await handleProjectSelect(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("projects.page_load_error"),
    });
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(mocked.clearAllInteractionStateMock).not.toHaveBeenCalled();
  });

  it("keeps project:* selection error behavior with state cleanup and chat error reply", async () => {
    const ctx = createCallbackContext("project:abc");
    mocked.getProjectsMock.mockResolvedValue([
      {
        id: "different-id",
        name: "Other project",
        worktree: "/tmp/other",
      },
    ]);

    const handled = await handleProjectSelect(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.clearAllInteractionStateMock).toHaveBeenCalledWith("project_select_error");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("projects.select_error") });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("switches projects while a foreground session is busy", async () => {
    container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    mocked.getProjectsMock.mockResolvedValue([
      { id: "abc", name: "Other", worktree: "/repo-other" },
    ]);
    mocked.switchToProjectMock.mockResolvedValue({
      keyboard: { inline_keyboard: [] },
      releasedRun: true,
    });

    const ctx = createCallbackContext("project:abc");
    const handled = await handleProjectSelect(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.switchToProjectMock).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalledWith({ text: t("bot.session_busy") });
    expect(ctx.reply).toHaveBeenCalledWith(t("projects.previous_run_continues"));
  });

  it("does not block permission callbacks while foreground session is busy", async () => {
    container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createCallbackContext("permission:once");
    const handled = await handleProjectSelect(ctx, createDeps());

    expect(handled).toBe(false);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
    expect(mocked.getProjectsMock).not.toHaveBeenCalled();
  });

  it("does not block question callbacks while foreground session is busy", async () => {
    container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createCallbackContext("question:select:0:1");
    const handled = await handleProjectSelect(ctx, createDeps());

    expect(handled).toBe(false);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
    expect(mocked.getProjectsMock).not.toHaveBeenCalled();
  });
});
