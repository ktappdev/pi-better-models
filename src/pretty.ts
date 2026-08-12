/**
 * pretty.ts — inlined UI primitives (icon glyph + modal frame).
 *
 * UI primitives this extension needs (icon glyph + modal frame):
 * actually used: `icon("picker.model")` and `frameLines`/`modalWidth`. Kept
 * minimal — only the keys/styles this picker needs — rather than vendoring the
 * whole catalog. Depends solely on pi-tui (already a peer dep).
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── Icon ──────────────────────────────────────────────────────────────────────

/** Presentation modes, in cycle order. nerd = Nerd Font PUA glyphs. */
export type IconMode = "nerd" | "unicode" | "ascii";

/** Force text (non-emoji) presentation for symbols that default to emoji. */
const VS = "\uFE0E";

/**
 * Minimal semantic icon catalog — only the keys this extension renders.
 * Each maps a semantic role to one glyph per mode:
 *   - nerd:    Nerd Font Private Use Area codepoint (needs a patched font).
 *   - unicode: standard BMP glyph that ships with virtually every monospace
 *              font (no Nerd Font required); +VS to force text presentation.
 *   - ascii:   pure ASCII, renders on literally any terminal.
 */
const CATALOG = {
	"picker.model": { nerd: "\u{F0229}", unicode: `\u25C8${VS}`, ascii: "M" },
} as const;

export type IconKey = keyof typeof CATALOG;

/**
 * Active mode. Seeded from PRETTY_ICONS env (back-compat: none/off => ascii).
 * No persistence layer here — the picker resolves icon() at render time and
 * doesn't need cross-session state.
 */
function envMode(): IconMode {
	const raw = (process.env.PRETTY_ICONS ?? "").toLowerCase();
	if (raw === "nerd" || raw === "unicode" || raw === "ascii") return raw;
	if (raw === "none" || raw === "off") return "ascii";
	return "nerd";
}

let activeMode: IconMode = envMode();

/** Current global icon mode. */
export function getIconMode(): IconMode {
	return activeMode;
}

/** Set the global icon mode (does NOT persist — render-time resolution only). */
export function setIconMode(mode: IconMode): void {
	if (mode === "nerd" || mode === "unicode" || mode === "ascii") activeMode = mode;
}

/**
 * Resolve a semantic icon key to its glyph for the active mode. Unknown keys
 * return "" (fail soft: never throw mid-render).
 */
export function icon(key: IconKey): string {
	const entry = CATALOG[key];
	return entry ? entry[activeMode] : "";
}

// ── Modal frame ───────────────────────────────────────────────────────────────

const MIN_WIDTH = 40;
const MAX_WIDTH = 96;
const MARGIN = 4;
/** 2 border cols + 2 padding spaces */
const CHROME = 4;

/** Clamp terminal width to a sane modal width (40–96 cols). */
export function modalWidth(termWidth: number): number {
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, termWidth - MARGIN));
}

export interface FrameOptions {
	width: number;
	lines: string[];
	/** Color function for border glyphs — e.g. `(s) => theme.fg("accent", s)` */
	color: (s: string) => string;
	/** Background fill function — e.g. `(s) => theme.bg("customMessageBg", s)` */
	bg?: (s: string) => string;
	/** Optional pre-styled string rendered as the first content row (tab bar etc.) */
	top?: string;
}

/**
 * Render a rounded modal box.
 *
 * Returns an array of full-width ANSI strings:
 *   ╭──────────────────╮
 *   │ [top row]        │   ← only if top is set
 *   │ content line 1   │
 *   │ content line 2   │
 *   ╰──────────────────╯
 *
 * Solid background fill — theme fg/bold spans that emit \x1b[0m are patched
 * so the background colour is re-asserted, preventing transparent holes.
 */
export function frameLines(opts: FrameOptions): string[] {
	const { width, lines, color, top } = opts;
	const bg = opts.bg ?? ((s: string) => s);
	const inner = Math.max(1, width - CHROME);
	const dashes = "─".repeat(width - 2);

	// Derive the bg OPEN sequence so we can re-assert it after any full reset
	// (\x1b[0m) or bg reset (\x1b[49m) embedded in content.
	const SENTINEL = "\x00";
	const bgOpen = bg(SENTINEL).split(SENTINEL)[0] ?? "";
	const reassert = (s: string): string =>
		bgOpen
			? s.replace(/\x1b\[([0-9;]*)m/g, (seq, p: string) =>
					p === "0" || p.split(";").includes("49") ? `${seq}${bgOpen}` : seq,
				)
			: s;

	const row = (content: string): string => {
		const pad = inner - visibleWidth(content);
		const padded = pad > 0 ? content + " ".repeat(pad) : truncateToWidth(content, inner);
		return bg(`${color("│")} ${reassert(padded)} ${color("│")}`);
	};

	const out: string[] = [bg(color(`╭${dashes}╮`))];
	if (top !== undefined) out.push(row(top));
	for (const line of lines) out.push(row(line));
	out.push(bg(color(`╰${dashes}╯`)));
	return out;
}
