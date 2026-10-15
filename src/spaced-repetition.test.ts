import { describe, expect, it } from "vitest";
import {
  formatSpacedRepetitionDeck,
  normalizeSpacedRepetitionDeckTag,
  normalizeSpacedRepetitionFolderPath,
  sanitizeSpacedRepetitionTitle,
  uniqueSpacedRepetitionPath
} from "./spaced-repetition";

describe("Spaced Repetition deck export", () => {
  it("normalizes deck names to a flashcards tag hierarchy", () => {
    expect(normalizeSpacedRepetitionDeckTag("#flashcards/Science / AI models")).toBe("flashcards/Science/AI-models");
    expect(normalizeSpacedRepetitionDeckTag("topic/sub topic")).toBe("flashcards/topic/sub-topic");
    expect(normalizeSpacedRepetitionDeckTag("")).toBe("flashcards");
  });

  it("rejects absolute and traversal folder paths", () => {
    expect(normalizeSpacedRepetitionFolderPath("Better Canvas/Flashcards")).toBe("Better Canvas/Flashcards");
    expect(() => normalizeSpacedRepetitionFolderPath("../outside")).toThrow();
    expect(() => normalizeSpacedRepetitionFolderPath("/outside")).toThrow();
    expect(() => normalizeSpacedRepetitionFolderPath("notes//cards")).toThrow();
  });

  it("sanitizes a source title for use as a safe filename", () => {
    expect(sanitizeSpacedRepetitionTitle("# AI / Canvas: notes\nignored second line")).toBe("AI - Canvas- notes");
    expect(sanitizeSpacedRepetitionTitle("../")).toBe("Flashcards");
  });

  it("generates Spaced Repetition multi-line cards and preserves answer Markdown", () => {
    const markdown = formatSpacedRepetitionDeck([
      { question: "What is Canvas?", answer: "A **visual** workspace.\nIt stores nodes." },
      { question: "What is this?\n?\nAn example", answer: "A second card." },
      { question: " ", answer: "discard empty questions" }
    ], "AI/Canvas", "Canvas basics");
    expect(markdown).toContain("  - flashcards/AI/Canvas");
    expect(markdown).toContain("What is Canvas?\n?\nA **visual** workspace.\nIt stores nodes.");
    expect(markdown).toContain("What is this?\n？\nAn example\n?\nA second card.");
    expect(markdown).not.toContain("discard empty questions");
  });

  it("rejects an export with no valid question/answer pairs", () => {
    expect(() => formatSpacedRepetitionDeck([{ question: "", answer: "answer" }], "", "Note")).toThrow("没有可导出的有效闪卡");
  });

  it("never chooses an existing note path, even on case-insensitive filesystems", () => {
    expect(uniqueSpacedRepetitionPath("Decks", "Revision", ["Decks/Revision.md"]))
      .toBe("Decks/Revision 2.md");
    expect(uniqueSpacedRepetitionPath("Decks", "Revision", ["decks/revision.md", "Decks/Revision 2.md"]))
      .toBe("Decks/Revision 3.md");
  });
});
