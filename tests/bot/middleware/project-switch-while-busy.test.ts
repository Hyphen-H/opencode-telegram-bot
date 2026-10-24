import type { Context } from "grammy";
import { describe, expect, it } from "vitest";
import { resolveInteractionGuardDecision } from "../../../src/bot/middleware/interaction-guard-decision.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import { startInteractionForTest } from "../../helpers/interaction.js";

function context(text?: string, callbackData?: string): Context {
  return {
    message: text ? { text } : undefined,
    callbackQuery: callbackData ? { data: callbackData } : undefined,
  } as unknown as Context;
}

describe("project switching while busy", () => {
  it("allows /projects while a foreground task runs", () => {
    const deps = createTestAppContainer();
    deps.foregroundSessionState.markBusy("session", "/repo");
    expect(resolveInteractionGuardDecision(context("/projects"), deps)).toMatchObject({
      allow: true,
      command: "/projects",
    });
  });

  it("allows project menu callbacks while busy but keeps other menus blocked", () => {
    const deps = createTestAppContainer();
    deps.foregroundSessionState.markBusy("session", "/repo");
    startInteractionForTest(deps.interactionManager, {
      kind: "inline",
      expectedInput: "callback",
      metadata: { menuKind: "project" },
    });
    expect(resolveInteractionGuardDecision(context(undefined, "project:p1"), deps).allow).toBe(
      true,
    );
    deps.interactionManager.transition({ metadata: { menuKind: "settings" } });
    expect(resolveInteractionGuardDecision(context(undefined, "settings:x"), deps).allow).toBe(
      false,
    );
  });
});
