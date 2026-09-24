import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { frameLines, modalOverlayWidth, modalWidth } from "./pretty.ts";

describe("modalWidth", () => {
	it("clamps very narrow terminals to the 40-col minimum", () => {
		expect(modalWidth(20)).toBe(40);
		expect(modalWidth(44)).toBe(40);
	});

	it("subtracts the 4-col margin from the terminal width", () => {
		expect(modalWidth(80)).toBe(76);
		expect(modalWidth(100)).toBe(96);
	});

	it("caps the modal at 120 cols so wide model names fit", () => {
		expect(modalWidth(136)).toBe(120);
		expect(modalWidth(400)).toBe(120);
	});

	it("grows past the old 96-col cap", () => {
		expect(modalWidth(124)).toBe(120);
		expect(modalWidth(124)).toBeGreaterThan(96);
	});
});

describe("modalOverlayWidth", () => {
	it("asks for the widest modal plus its margin", () => {
		// pi-tui renders the overlay at exactly this width, so the request has to
		// cover the full modal — otherwise MAX_WIDTH is unreachable.
		expect(modalOverlayWidth()).toBe(124);
		expect(modalWidth(modalOverlayWidth())).toBe(120);
	});

	it("keeps the modal within the width the host actually grants", () => {
		// The host clamps the request to the terminal; verify the modal never
		// exceeds what it gets back.
		for (const term of [40, 60, 80, 100, 124, 400]) {
			const granted = Math.min(modalOverlayWidth(), term);
			expect(modalWidth(granted)).toBeLessThanOrEqual(granted);
		}
	});

	it("widens the modal past the old 80-col overlay cap on wide terminals", () => {
		// Without a width request the overlay is min(80, term) — the old ceiling.
		expect(modalWidth(80)).toBe(76);
		expect(modalWidth(modalOverlayWidth())).toBeGreaterThan(76);
	});
});

describe("frameLines at the widened modal width", () => {
	it("fills every row to the full modal width", () => {
		const width = modalWidth(400);
		const lines = frameLines({
			width,
			lines: ["▶ #1 routeway/qwen3.5-27b-claude-4.6-opus-reasoning-distilled-derestricted-lite"],
			color: (s) => s,
		});
		expect(lines.length).toBe(3); // top border, one content row, bottom border
		for (const line of lines) expect(visibleWidth(line)).toBe(width);
	});

	it("truncates content that exceeds the inner width", () => {
		const width = 40;
		const lines = frameLines({ width, lines: ["x".repeat(200)], color: (s) => s });
		for (const line of lines) expect(visibleWidth(line)).toBe(width);
	});
});
