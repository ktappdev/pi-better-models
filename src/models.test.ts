import { describe, expect, it } from "bun:test";
import { SelectList, visibleWidth } from "@earendil-works/pi-tui";
import {
	benchGrade,
	getModelDetailColumns,
	filterModelItems,
	fmtCost,
	fmtCtx,
	MIN_MODEL_PRIMARY_COLUMN_WIDTH,
	MODEL_SELECTION_NEXT_KEY,
	MODEL_SELECTION_PREVIOUS_KEY,
	type ModelSearchLookup,
	modelPrimaryColumnWidth,
	modelSelectionCycleKey,
	normalizeModelText,
	sortModels,
	stepEffectiveThinkingLevel,
	stepThinkingLevel,
	THINKING_LEVELS,
} from "./models.ts";

describe("modelSelectionCycleKey", () => {
	it("maps Tab to next selection", () => {
		expect(modelSelectionCycleKey("next")).toBe(MODEL_SELECTION_NEXT_KEY);
		expect(MODEL_SELECTION_NEXT_KEY).toBe("\x1b[B");
	});

	it("maps Shift+Tab to previous selection", () => {
		expect(modelSelectionCycleKey("previous")).toBe(MODEL_SELECTION_PREVIOUS_KEY);
		expect(MODEL_SELECTION_PREVIOUS_KEY).toBe("\x1b[A");
	});
});

describe("stepThinkingLevel", () => {
	it("steps up one notch", () => {
		expect(stepThinkingLevel("low", 1)).toBe("medium");
		expect(stepThinkingLevel("off", 1)).toBe("minimal");
	});
	it("steps down one notch", () => {
		expect(stepThinkingLevel("medium", -1)).toBe("low");
		expect(stepThinkingLevel("xhigh", -1)).toBe("high");
	});
	it("clamps at the low end (no wrap)", () => {
		expect(stepThinkingLevel("off", -1)).toBe("off");
	});
	it("clamps at the high end (no wrap)", () => {
		expect(stepThinkingLevel("xhigh", 1)).toBe("max");
		expect(stepThinkingLevel("max", 1)).toBe("max");
	});
	it("falls back to a medium-anchored step for unknown input", () => {
		expect(stepThinkingLevel("bogus", 1)).toBe("high");
		expect(stepThinkingLevel("", -1)).toBe("low");
	});
	it("exposes the seven canonical levels ascending", () => {
		expect(THINKING_LEVELS).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
	});
	it("can walk the full ladder up and back down", () => {
		let lvl: string = "off";
		for (let i = 0; i < 10; i++) lvl = stepThinkingLevel(lvl, 1);
		expect(lvl).toBe("max");
		for (let i = 0; i < 10; i++) lvl = stepThinkingLevel(lvl, -1);
		expect(lvl).toBe("off");
	});
});

describe("stepEffectiveThinkingLevel", () => {
	it("skips levels that clamp back to the current level", () => {
		const clamp = (requested: string) => {
			if (requested === "minimal" || requested === "low") return "off";
			return requested;
		};
		expect(stepEffectiveThinkingLevel("off", 1, clamp)).toBe("medium");
	});

	it("stays at an endpoint when every farther request clamps back", () => {
		expect(stepEffectiveThinkingLevel("high", 1, () => "high")).toBe("high");
	});
});

describe("fmtCtx", () => {
	it("formats 0 as 0", () => expect(fmtCtx(0)).toBe("0"));
	it("formats small numbers as-is", () => expect(fmtCtx(512)).toBe("512"));
	it("formats thousands as Nk", () => {
		expect(fmtCtx(128_000)).toBe("128k");
		expect(fmtCtx(8_192)).toBe("8k");
	});
	it("formats millions as NM", () => {
		expect(fmtCtx(1_000_000)).toBe("1M");
		expect(fmtCtx(2_000_000)).toBe("2M");
		expect(fmtCtx(1_500_000)).toBe("1.5M");
	});
});

describe("fmtCost", () => {
	it("returns — for undefined entry", () => expect(fmtCost(undefined)).toBe("—"));
	it("returns — when no cost field", () => expect(fmtCost({})).toBe("—"));
	it("returns free when both 0", () => {
		expect(fmtCost({ cost: { input: 0, output: 0 } })).toBe("free");
	});
	it("formats input/output costs", () => {
		expect(fmtCost({ cost: { input: 3, output: 15 } })).toBe("3.00/15.00");
	});
	it("handles missing input/output as 0", () => {
		expect(fmtCost({ cost: {} })).toBe("free");
	});
});

describe("benchGrade", () => {
	it("gives A+ for score >= 80", () => {
		expect(benchGrade(95)).toBe("A+");
		expect(benchGrade(80)).toBe("A+");
	});
	it("gives A for 76-79", () => {
		expect(benchGrade(78)).toBe("A");
		expect(benchGrade(76)).toBe("A");
	});
	it("gives A− for 73-75", () => {
		expect(benchGrade(75)).toBe("A−");
		expect(benchGrade(73)).toBe("A−");
	});
	it("gives B+ for 70-72", () => {
		expect(benchGrade(72)).toBe("B+");
		expect(benchGrade(70)).toBe("B+");
	});
	it("gives B for 67-69", () => {
		expect(benchGrade(69)).toBe("B");
		expect(benchGrade(67)).toBe("B");
	});
	it("gives B− for 64-66", () => {
		expect(benchGrade(66)).toBe("B−");
		expect(benchGrade(64)).toBe("B−");
	});
	it("gives C+ for 61-63", () => {
		expect(benchGrade(63)).toBe("C+");
		expect(benchGrade(61)).toBe("C+");
	});
	it("gives C for 58-60", () => {
		expect(benchGrade(60)).toBe("C");
		expect(benchGrade(58)).toBe("C");
	});
	it("gives C− for 55-57", () => {
		expect(benchGrade(57)).toBe("C−");
		expect(benchGrade(55)).toBe("C−");
	});
	it("gives D for 50-54", () => {
		expect(benchGrade(54)).toBe("D");
		expect(benchGrade(50)).toBe("D");
	});
	it("gives F for score < 50", () => {
		expect(benchGrade(49)).toBe("F");
		expect(benchGrade(0)).toBe("F");
	});
	it("gives — for null/undefined", () => {
		expect(benchGrade(null)).toBe("—");
		expect(benchGrade(undefined)).toBe("—");
	});
	it("every integer 0-100 maps to a grade (no holes)", () => {
		const grades = new Set<string>();
		for (let s = 0; s <= 100; s++) grades.add(benchGrade(s));
		expect(grades.size).toBeGreaterThan(1);
		// Boundaries: 80, 76, 73, 70, 67, 64, 61, 58, 55, 50
		const boundary = [80, 76, 73, 70, 67, 64, 61, 58, 55, 50];
		for (const s of boundary) expect(benchGrade(s)).not.toBe(benchGrade(s - 1));
	});
});


describe("getModelDetailColumns", () => {
	it("defaults to pricing and score", () => {
		expect(getModelDetailColumns(undefined)).toEqual(["pricing", "score"]);
	});

	it("accepts configured columns in order", () => {
		expect(getModelDetailColumns("context,pricing,score")).toEqual(["context", "pricing", "score"]);
		expect(getModelDetailColumns("score,pricing")).toEqual(["score", "pricing"]);
	});

	it("deduplicates and ignores unknown columns", () => {
		expect(getModelDetailColumns("pricing,wat,pricing,score")).toEqual(["pricing", "score"]);
	});

	it("falls back when configuration has no valid columns", () => {
		expect(getModelDetailColumns("wat,nothing")).toEqual(["pricing", "score"]);
		expect(getModelDetailColumns("")).toEqual(["pricing", "score"]);
	});
});
// ─── modelPrimaryColumnWidth ──────────────────────────────────────────────────

// Widest row in the real catalog: marker + rank cell + `provider/id`
// (routeway/qwen3.5-27b-claude-4.6-opus-reasoning-distilled-derestricted-lite).
const WIDEST_LABEL = 79;
// Default PI_MODELS_COLUMNS rendering: "3.00/15.00 · ⚡78 A"
const WIDEST_DESC = 18;

describe("modelPrimaryColumnWidth", () => {
	it("keeps the legacy 40-col cap on frames too narrow to widen it", () => {
		expect(MIN_MODEL_PRIMARY_COLUMN_WIDTH).toBe(40);
		expect(modelPrimaryColumnWidth(WIDEST_LABEL, WIDEST_DESC, 36)).toBe(40);
		expect(modelPrimaryColumnWidth(WIDEST_LABEL, WIDEST_DESC, 56)).toBe(40);
	});

	it("grows past the old 40-col cap as the frame allows", () => {
		expect(modelPrimaryColumnWidth(WIDEST_LABEL, WIDEST_DESC, 72)).toBe(50);
		expect(modelPrimaryColumnWidth(WIDEST_LABEL, WIDEST_DESC, 116)).toBe(81);
	});

	it("fits the widest label once the frame is wide enough", () => {
		// 120-col modal → 116 inner.
		expect(modelPrimaryColumnWidth(WIDEST_LABEL, WIDEST_DESC, 116)).toBeGreaterThanOrEqual(
			WIDEST_LABEL,
		);
	});

	it("never spends the columns the widest description needs", () => {
		const inner = 116;
		// Even an absurdly long label leaves the description + SelectList's slack.
		expect(modelPrimaryColumnWidth(1_000, WIDEST_DESC, inner)).toBe(inner - 4 - WIDEST_DESC);
	});

	it("reserves at least SelectList's 11-col description minimum", () => {
		// Below that pi-tui drops the description entirely.
		expect(modelPrimaryColumnWidth(1_000, 0, 116)).toBe(116 - 4 - 11);
	});

	it("shrinks to a short label instead of padding it out", () => {
		expect(modelPrimaryColumnWidth(20, WIDEST_DESC, 116)).toBe(22);
	});

	it("is monotonic in frame width", () => {
		let previous = 0;
		for (let inner = 20; inner <= 140; inner++) {
			const width = modelPrimaryColumnWidth(WIDEST_LABEL, WIDEST_DESC, inner);
			expect(width).toBeGreaterThanOrEqual(previous);
			previous = width;
		}
	});
});

// ─── picker rows with wide model names (real SelectList) ──────────────────────

describe("picker rows with wide model names", () => {
	const theme = {
		selectedPrefix: (t: string) => t,
		selectedText: (t: string) => t,
		description: (t: string) => t,
		scrollInfo: (t: string) => t,
		noMatch: (t: string) => t,
	};
	const label =
		"▶ #1 routeway/qwen3.5-27b-claude-4.6-opus-reasoning-distilled-derestricted-lite";
	const description = "3.00/15.00 · ⚡78 A";
	const items = [{ value: "routeway/wide", label, description }];
	const widestLabel = visibleWidth(label);
	const widestDescription = visibleWidth(description);

	/** Render the row the way the picker does: column derived from frame width. */
	function renderRow(inner: number): string {
		const width = modelPrimaryColumnWidth(widestLabel, widestDescription, inner);
		const list = new SelectList(items, 1, theme, {
			minPrimaryColumnWidth: width,
			maxPrimaryColumnWidth: width,
		});
		return list.render(inner)[0] ?? "";
	}

	it("shows the full name and the metadata on a wide frame", () => {
		const line = renderRow(116);
		expect(line).toContain(label);
		expect(line).toContain(description);
		expect(visibleWidth(line)).toBeLessThanOrEqual(116);
	});

	it("keeps the metadata when the name truncates on a mid frame", () => {
		const line = renderRow(72);
		expect(line).not.toContain(label); // must truncate at 80 cols
		expect(line).toContain(description);
		expect(visibleWidth(line)).toBeLessThanOrEqual(72);
	});

	it("falls back to a label-only row on a very narrow frame", () => {
		const line = renderRow(36);
		expect(line).not.toContain(description);
		expect(visibleWidth(line)).toBeLessThanOrEqual(36);
	});

	it("never drops the metadata on a frame wide enough to hold it", () => {
		// Regression guard for the pi-tui rule: the description disappears once
		// fewer than 10 columns remain after the label column.
		for (let inner = 56; inner <= 140; inner++) {
			const line = renderRow(inner);
			expect(line).toContain("3.00/15.00");
			expect(visibleWidth(line)).toBeLessThanOrEqual(inner);
		}
	});
});

describe("sortModels", () => {
	const models = [
		{ provider: "a", id: "m1", name: "Zebra", score: 80 },
		{ provider: "a", id: "m2", name: "Alpha", score: 95 },
		{ provider: "a", id: "m3", name: "Middle", score: null },
		{ provider: "a", id: "m4", name: "Beta", score: 80 },
	];
	type ModelEntry = (typeof models)[number];

	it("sorts by score descending", () => {
		const sorted = sortModels(models);
		expect((sorted[0] as ModelEntry).name).toBe("Alpha"); // score 95
	});

	it("breaks score ties alphabetically by name", () => {
		const sorted = sortModels(models);
		const tiedIdx = sorted.findIndex((m) => m.name === "Beta");
		const zebraIdx = sorted.findIndex((m) => m.name === "Zebra");
		expect(tiedIdx).toBeLessThan(zebraIdx); // Beta before Zebra, both score 80
	});

	it("puts null score models last", () => {
		const sorted = sortModels(models);
		expect((sorted[sorted.length - 1] as ModelEntry).name).toBe("Middle");
	});

	it("does not mutate the original array", () => {
		const original = [...models];
		sortModels(models);
		expect(models).toEqual(original);
	});

	it("puts null score models after all scored models regardless of source order", () => {
		const shuffled = [
			{ provider: "a", id: "m1", name: "Zeta", score: null },
			{ provider: "a", id: "m2", name: "Beta", score: 80 },
			{ provider: "a", id: "m3", name: "Alpha", score: 95 },
			{ provider: "a", id: "m4", name: "Gamma", score: null },
			{ provider: "a", id: "m5", name: "Delta", score: 60 },
		];
		const sorted = sortModels(shuffled);
		const lastTwo = sorted.slice(-2).map((m) => m.name);
		expect(lastTwo).toEqual(["Gamma", "Zeta"]); // nulls last, stable within
	});

	it("sinks tier 2 (off-catalog) below tier 1 (benched-but-unscored)", () => {
		// Mirrors the openrouter/owl-alpha bug: a model with no bench entry at
		// all must not interleave with benched models that happen to have a
		// null score.
		const mixed = [
			{ provider: "a", id: "m1", name: "Alpha", score: 95, tier: 0 },
			{ provider: "a", id: "m2", name: "Beta", score: null, tier: 1 },
			{ provider: "a", id: "m3", name: "Gamma", score: undefined, tier: 2 },
			{ provider: "a", id: "m4", name: "Delta", score: 60, tier: 0 },
		];
		const sorted = sortModels(mixed);
		expect(sorted.map((m) => m.name)).toEqual(["Alpha", "Delta", "Beta", "Gamma"]);
	});
});

// ─── normalizeModelText ───────────────────────────────────────────────────────

describe("normalizeModelText", () => {
	it("lowercases", () => {
		expect(normalizeModelText("GLM-5.2")).toBe("glm52");
	});

	it("strips hyphens", () => {
		expect(normalizeModelText("claude-opus-4-8")).toBe("claudeopus48");
	});

	it("strips dots", () => {
		expect(normalizeModelText("qwen3.7-max")).toBe("qwen37max");
	});

	it("strips all non-alphanumeric", () => {
		expect(normalizeModelText("a!b@c#d$e%f^g&h")).toBe("abcdefgh");
	});

	it("handles plain alphanumeric", () => {
		expect(normalizeModelText("abc123")).toBe("abc123");
	});

	it("handles empty string", () => {
		expect(normalizeModelText("")).toBe("");
	});
});

// ─── filterModelItems ─────────────────────────────────────────────────────────

describe("filterModelItems", () => {
	// Fixture: models with ids matching the acceptance criteria.
	// Ranks are assigned so some overlap with digit-queries.
	const mk = (id: string, rank?: number) => ({
		value: `p/${id}`,
		_rank: rank,
	});

	type Fixture = ReturnType<typeof mk>;

	/** Build lookup maps exactly like production: haystack = `${id} ${name ?? ""}`. */
	function buildLookup(items: Fixture[]): ModelSearchLookup {
		const rankByValue = new Map<string, number>();
		const searchTextByValue = new Map<string, string>();
		const normalizedByValue = new Map<string, string>();
		for (const it of items) {
			// value is "p/glm-5.2" — extract the id part.
			const id = it.value.split("/")[1] ?? "";
			if (it._rank != null) rankByValue.set(it.value, it._rank);
			const text = `${id} ${""}`; // no name in test fixture
			searchTextByValue.set(it.value, text);
			normalizedByValue.set(it.value, normalizeModelText(text));
		}
		return { rankByValue, searchTextByValue, normalizedByValue };
	}

	// Full fixture with ranks: glm-5.2→3, minimax-m3→8, claude-opus-4-8→2.
	const allItems: Fixture[] = [
		mk("glm-5.2", 3),
		mk("glm-5.1"),
		mk("minimax-m3", 8),
		mk("claude-opus-4-8", 2),
		mk("claude-sonnet-4-6"),
		mk("qwen3.7-max"),
	];
	const allLookup = buildLookup(allItems);

	function values(result: Fixture[]): string[] {
		return result.map((it) => it.value);
	}

	it("empty query returns all items in original order", () => {
		const result = filterModelItems(allItems, "", allLookup);
		expect(values(result)).toEqual(allItems.map((it) => it.value));
	});

	it("query '52' includes glm-5.2 via normalized substring", () => {
		const result = filterModelItems(allItems, "52", allLookup);
		expect(values(result)).toContain("p/glm-5.2");
	});

	it("query 'm3' includes minimax-m3 first (substring priority over fuzzy noise)", () => {
		const result = filterModelItems(allItems, "m3", allLookup);
		expect(values(result)[0]).toBe("p/minimax-m3");
	});

	it("query '48' includes claude-opus-4-8", () => {
		const result = filterModelItems(allItems, "48", allLookup);
		expect(values(result)).toContain("p/claude-opus-4-8");
	});

	it("exact id query 'glm-5.2' still matches glm-5.2", () => {
		const result = filterModelItems(allItems, "glm-5.2", allLookup);
		expect(values(result)).toContain("p/glm-5.2");
	});

	it("digit query matching a rank returns that ranked item first", () => {
		// glm-5.2 has rank 3 — query "3" should put it first.
		const result = filterModelItems(allItems, "3", allLookup);
		expect(values(result)[0]).toBe("p/glm-5.2");
	});

	it("dedupe: item matching both rank and substring appears once", () => {
		// claude-opus-4-8 has rank 2; query "2" matches by rank AND
		// normalized substring ("2" ⊂ "claudeopus48"). Should appear once.
		const result = filterModelItems(allItems, "2", allLookup);
		const occurrences = values(result).filter((v) => v === "p/claude-opus-4-8");
		expect(occurrences.length).toBe(1);
	});

	it("digit query '8' (rank 8) returns minimax-m3 as rank match first", () => {
		const result = filterModelItems(allItems, "8", allLookup);
		expect(values(result)[0]).toBe("p/minimax-m3");
	});

	it("whitespace query is treated as empty", () => {
		const result = filterModelItems(allItems, "   ", allLookup);
		expect(values(result)).toEqual(allItems.map((it) => it.value));
	});
});

describe("memoized data indexes", () => {
	it("returns identical Map reference on repeated getBenchIndex calls", async () => {
		const { getBenchIndex } = await import("./data.ts");
		const index1 = getBenchIndex();
		const index2 = getBenchIndex();
		expect(index1).toBe(index2);
	});

	it("returns identical Map reference on repeated getModelsDevIndex calls", async () => {
		const { getModelsDevIndex } = await import("./data.ts");
		const index1 = getModelsDevIndex();
		const index2 = getModelsDevIndex();
		expect(index1).toBe(index2);
	});

	it("prefetchModelData executes without throwing", async () => {
		const { prefetchModelData } = await import("./data.ts");
		const results = await prefetchModelData();
		expect(Array.isArray(results)).toBe(true);
		expect(results.length).toBe(2);
	});
});

