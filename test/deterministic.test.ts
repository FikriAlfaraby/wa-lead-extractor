import { describe, it, expect } from "vitest";
import { parseMoneyToIDR, extractDeterministic } from "../src/deterministic.js";
import type { Conversation } from "../src/schema.js";

function lead(text: string): Conversation["messages"][number] {
  return { speaker: "lead", text };
}
function agent(text: string): Conversation["messages"][number] {
  return { speaker: "agent", text };
}

describe("parseMoneyToIDR", () => {
  it("parses '800jt' as 800 million", () => {
    expect(parseMoneyToIDR("budgetnya 800jt aja")).toEqual({
      amount: 800_000_000,
      matchedText: "800jt",
    });
  });

  it("parses '1.5M' as 1.5 billion (miliar convention)", () => {
    expect(parseMoneyToIDR("sekitar 1.5M all-in")).toEqual({
      amount: 1_500_000_000,
      matchedText: "1.5M",
    });
  });

  it("parses '2 miliar' as 2 billion", () => {
    expect(parseMoneyToIDR("budget 2 miliar lah")).toEqual({
      amount: 2_000_000_000,
      matchedText: "2 miliar",
    });
  });

  it("parses 'Rp 900 juta' as 900 million", () => {
    expect(parseMoneyToIDR("Rp 900 juta paling mentok")).toEqual({
      amount: 900_000_000,
      matchedText: "Rp 900 juta",
    });
  });

  it("returns null when there is no money pattern", () => {
    expect(parseMoneyToIDR("saya masih liat-liat aja")).toBeNull();
  });

  it("does not match spelled-out numbers (word-form amounts)", () => {
    expect(parseMoneyToIDR("budgetnya sekitar setengah miliar an")).toBeNull();
  });
});

describe("extractDeterministic", () => {
  it("extracts explicit buy intent, high urgency, and budget from lead messages", () => {
    const conversation: Conversation = {
      id: "t1",
      messages: [
        lead("saya mau beli ya bukan sewa"),
        agent("budget kisaran berapa kak?"),
        lead("budget saya sekitar 1.5M all-in"),
        lead("bulan ini kalo bisa gan"),
      ],
    };

    const result = extractDeterministic(conversation);
    expect(result.intent).toBe("buy");
    expect(result.intentCitation).toBe("mau beli");
    expect(result.budgetIDR).toBe(1_500_000_000);
    expect(result.urgency).toBe("high");
    expect(result.urgencyCitation).toBe("bulan ini");
  });

  it("extracts rent intent and low urgency", () => {
    const conversation: Conversation = {
      id: "t2",
      messages: [
        lead("mau cari sewa apartemen studio"),
        lead("santai aja gan, tahun depan juga oke"),
      ],
    };

    const result = extractDeterministic(conversation);
    expect(result.intent).toBe("rent");
    expect(result.urgency).toBe("low");
  });

  it("ignores money and keywords stated only by the agent", () => {
    const conversation: Conversation = {
      id: "t3",
      messages: [
        lead("unit di Alam Sutera msh ada?"),
        agent("biasanya budget di kisaran 1.5M ya kak, mau beli urgent ga?"),
        lead("blm tau juga sih"),
      ],
    };

    const result = extractDeterministic(conversation);
    expect(result.budgetIDR).toBeNull();
    expect(result.intent).toBeNull();
    expect(result.urgency).toBeNull();
  });

  it("returns all nulls for a conversation with no extractable facts", () => {
    const conversation: Conversation = {
      id: "t4",
      messages: [lead("halo min"), agent("halo kak ada yg bisa dibantu?"), lead("mau tanya2 dulu")],
    };

    const result = extractDeterministic(conversation);
    expect(result.budgetIDR).toBeNull();
    expect(result.intent).toBeNull();
    expect(result.urgency).toBeNull();
  });
});
