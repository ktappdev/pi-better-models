/**
 * data.ts — model data layer for the enhanced /models picker.
 *
 * Coding-focused. Sources, in priority order:
 *   1. modelgrep (https://modelgrep.com/api/v1/models?sort=coding) — no key,
 *      CORS-enabled, republishes Artificial Analysis benchmarks + pricing +
 *      context + capabilities. The primary source. Cached at
 *      ~/.cache/pi/modelgrep.json (TTL 24h).
 *   2. Artificial Analysis free API (https://artificialanalysis.ai/api/v2/
 *      data/llms/models) — first-party, requires ARTIFICIAL_ANALYSIS_API_KEY
 *      (or AA_API_KEY) env var. Used as a fallback ONLY for the coding score:
 *      modelgrep is the richer catalog (AA free tier omits context window,
 *      modalities, per-benchmark detail), so we keep modelgrep for everything
 *      except filling a missing `artificial_analysis_coding_index`. Cached at
 *      ~/.cache/pi/aa.json.
 *
 * The headline score is the AA Coding Index (0–100) — a real coding score,
 * not the general Intelligence Index rescaled to look like one. Models without
 * a coding index sink to the unscored tier; rank is computed locally among the
 * user's available models (best pickable = #1).
 *
 * Cache files live under ~/.cache/pi/ and are shared across Pi extensions —
 * whichever extension loads first populates them; later loads read from disk.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModelsDevModel {
	id: string;
	name?: string;
	reasoning?: boolean;
	modalities?: { input?: string[]; output?: string[] };
	limit?: { context?: number; output?: number };
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
}

export type ModelsDevApi = Record<string, { models?: Record<string, ModelsDevModel> }>;

export interface BenchmarkEntry {
	rank: number;
	model: string;
	creator: string;
	/** AA Coding Index (0–100), or null when no coding benchmark exists. */
	overallScore: number | null;
	/** The AA Coding Index value before any rounding, for diagnostics. */
	categoryScores?: Record<string, number | null>;
	inputPrice: number | null;
	outputPrice: number | null;
}

export interface ModelGrepModel {
	id: string;
	name?: string;
	context_length?: number;
	max_output?: number;
	pricing?: { input?: number; output?: number; cache_read?: number };
	modality?: { input?: string[]; output?: string[] };
	capabilities?: { reasoning?: boolean; tools?: boolean; vision?: boolean };
	benchmarks?: {
		artificial_analysis?: {
			/** AA Intelligence Index — general 9-eval composite. NOT the coding score. */
			intelligence?: number | null;
			/** AA Coding Index (0–100) — the headline score we display. */
			coding?: number | null;
			agentic?: number | null;
			gpqa?: number | null;
			scicode?: number | null;
			terminalbench?: number | null;
			tau2?: number | null;
			livecodebench?: number | null;
			hle?: number | null;
		};
	};
}

interface ModelGrepResponse {
	data: ModelGrepModel[];
}

/** Artificial Analysis free-tier model record (subset we use). */
interface AAFreeModel {
	slug?: string;
	name?: string;
	model_creator?: { slug?: string; name?: string };
	evaluations?: {
		artificial_analysis_coding_index?: number | null;
		artificial_analysis_intelligence_index?: number | null;
	};
	pricing?: {
		price_1m_input_tokens?: number;
		price_1m_output_tokens?: number;
	};
}

/** Legacy free endpoint returns `{ status, prompt_options, data }`. */
interface AAFreeResponse {
	status?: number;
	data?: AAFreeModel[];
}

// ── DataSource ───────────────────────────────────────────────────────────────

interface DataSourceOptions<T> {
	url: string | (() => string);
	headers?: () => Record<string, string> | undefined;
	cachePath: string;
	ttlMs?: number;
	timeoutMs?: number;
	parse: (raw: unknown) => T;
	parseCache: (data: unknown) => T;
	empty: T;
	label: string;
	skip?: () => boolean;
	/**
	 * Optional override for sources that need multiple requests (pagination).
	 * Returns the merged raw payload, handed to `parse`/cached as a single
	 * response would be.
	 */
	fetchRaw?: (
		url: string,
		headers: Record<string, string> | undefined,
		timeoutMs: number,
	) => Promise<unknown>;
}

export class DataSource<T> {
	private _mem: T | null = null;
	private _inflight: Promise<T> | null = null;
	private readonly opts: Required<DataSourceOptions<T>>;

	constructor(opts: DataSourceOptions<T>) {
		this.opts = {
			ttlMs: 24 * 60 * 60 * 1000,
			timeoutMs: 10_000,
			headers: () => undefined,
			skip: () => false,
			fetchRaw: defaultFetchRaw,
			...opts,
		};
	}

	async get(): Promise<T> {
		if (this._inflight) return this._inflight;
		this._inflight = this._load().finally(() => {
			this._inflight = null;
		});
		return this._inflight;
	}

	getCached(): T {
		if (this._mem) return this._mem;
		try {
			if (existsSync(this.opts.cachePath)) {
				const raw = JSON.parse(readFileSync(this.opts.cachePath, "utf-8")) as {
					data: unknown;
				};
				this._mem = this.opts.parseCache(raw.data);
				return this._mem;
			}
		} catch {
			// No cache file or parse error — return empty, not fatal
		}
		return this.opts.empty;
	}

	private async _load(): Promise<T> {
		if (this.opts.skip()) {
			this._mem = this.opts.empty;
			return this.opts.empty;
		}
		const cached = await this._readCache();
		if (cached !== undefined && Date.now() - cached.ts < this.opts.ttlMs) {
			const val = this.opts.parseCache(cached.data);
			this._mem = val;
			return val;
		}
		try {
			const url = typeof this.opts.url === "function" ? this.opts.url() : this.opts.url;
			const raw = await this.opts.fetchRaw(url, this.opts.headers(), this.opts.timeoutMs);
			const val = this.opts.parse(raw);
			this._mem = val;
			void this._writeCache(raw);
			return val;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (cached !== undefined) {
				console.warn(`${this.opts.label} fetch failed, using stale cache: ${msg}`);
				const val = this.opts.parseCache(cached.data);
				this._mem = val;
				return val;
			}
			console.warn(`${this.opts.label} unavailable: ${msg}`);
			return this.opts.empty;
		}
	}

	private async _readCache(): Promise<{ ts: number; data: unknown } | undefined> {
		try {
			const raw = await readFile(this.opts.cachePath, "utf8");
			const parsed = JSON.parse(raw) as { ts: number; data: unknown };
			if (typeof parsed.ts !== "number") return undefined;
			return parsed;
		} catch {
			return undefined;
		}
	}

	private async _writeCache(data: unknown): Promise<void> {
		try {
			await mkdir(dirname(this.opts.cachePath), { recursive: true });
			await writeFile(this.opts.cachePath, JSON.stringify({ ts: Date.now(), data }));
		} catch {
			// Write failure is non-fatal — stale cache used on next run
		}
	}
}

function fetchWithTimeout(
	url: string,
	timeoutMs: number,
	headers?: Record<string, string>,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	return fetch(url, { signal: controller.signal, headers }).finally(() => clearTimeout(timer));
}

/** Single-request raw fetch — the default DataSource fetch strategy. */
async function defaultFetchRaw(
	url: string,
	headers: Record<string, string> | undefined,
	timeoutMs: number,
): Promise<unknown> {
	const response = await fetchWithTimeout(url, timeoutMs, headers);
	if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
	return response.json();
}

const MODELGREP_PAGE = 200; // modelgrep hard page-size cap
const MODELGREP_MAX_PAGES = 10; // safety bound (~2000 models)

interface ModelGrepPage {
	data?: ModelGrepModel[];
	meta?: { has_more?: boolean; next_offset?: number };
}

/**
 * Paginating fetch for modelgrep: walks `meta.has_more`/`next_offset` and
 * merges every page into one `{ data }` payload so `parse` and the cache see
 * the full catalog as a single response. `url` already carries the query
 * (sort/limit); we only append `&offset=`.
 */
async function fetchModelGrepAll(
	url: string,
	headers: Record<string, string> | undefined,
	timeoutMs: number,
): Promise<{ data: ModelGrepModel[] }> {
	const all: ModelGrepModel[] = [];
	let offset = 0;
	for (let page = 0; page < MODELGREP_MAX_PAGES; page++) {
		const sep = url.includes("?") ? "&" : "?";
		const res = (await defaultFetchRaw(
			`${url}${sep}offset=${offset}`,
			headers,
			timeoutMs,
		)) as ModelGrepPage;
		if (res.data?.length) all.push(...res.data);
		if (!res.meta?.has_more) break;
		offset = res.meta.next_offset ?? offset + MODELGREP_PAGE;
	}
	return { data: all };
}

// ── Cache dir ─────────────────────────────────────────────────────────────────

export const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "pi");

// ── Data sources ──────────────────────────────────────────────────────────────

export const modelgrep = new DataSource<ModelGrepModel[]>({
	label: "modelgrep",
	url: `https://modelgrep.com/api/v1/models?sort=coding&order=desc&limit=${MODELGREP_PAGE}`,
	cachePath: join(CACHE_DIR, "modelgrep.json"),
	fetchRaw: fetchModelGrepAll,
	parse: (raw) => (raw as ModelGrepResponse).data ?? [],
	parseCache: (data) => (data as ModelGrepResponse)?.data ?? [],
	empty: [],
});

/**
 * Artificial Analysis free API — coding-index fallback. Only fetched when an
 * API key is set; otherwise skipped (empty), so users without a key pay
 * nothing. Reads ARTIFICIAL_ANALYSIS_API_KEY (preferred) or AA_API_KEY.
 *
 * Uses the legacy `/api/v2/data/llms/models` path: it is the documented free
 * endpoint in the API Reference and accepts the key via `x-api-key`, whereas
 * the newer `/api/v2/language/models/free` sub-path 401s the same key. The
 * legacy path returns the full free-tier payload (597 models, 209 with a
 * coding index) in a single unpaginated response.
 * See https://artificialanalysis.ai/api-reference.
 */
export const artificialAnalysis = new DataSource<AAFreeModel[]>({
	label: "artificial-analysis",
	url: "https://artificialanalysis.ai/api/v2/data/llms/models",
	headers: () => {
		const key = process.env.ARTIFICIAL_ANALYSIS_API_KEY ?? process.env.AA_API_KEY;
		return key ? { "x-api-key": key } : undefined;
	},
	skip: () => !process.env.ARTIFICIAL_ANALYSIS_API_KEY && !process.env.AA_API_KEY,
	cachePath: join(CACHE_DIR, "aa.json"),
	parse: (raw) => (raw as AAFreeResponse).data ?? [],
	parseCache: (data) => (data as AAFreeResponse)?.data ?? [],
	empty: [],
});

/** Prefetch all upstream model data sources in parallel. */
export function prefetchModelData(): Promise<
	[PromiseSettledResult<ModelGrepModel[]>, PromiseSettledResult<AAFreeModel[]>]
> {
	return Promise.allSettled([modelgrep.get(), artificialAnalysis.get()]);
}

// ── Lookup helpers ─────────────────────────────────────────────────────────────

function normalize(id: string): string {
	return id
		.toLowerCase()
		.replace(/[:@].*$/, "") // routing suffix (:nitro, @date)
		.replace(/[._]/g, "-") // fold separators: modelgrep `4.5` ↔ Pi routing `4-5`
		.replace(/-\d{8}$/, ""); // trailing -YYYYMMDD
}

function stripPrefix(id: string): string {
	const i = id.lastIndexOf("/");
	return i >= 0 ? id.slice(i + 1) : id;
}

/** Slug = model id without its maker/provider prefix. */
function slugOf(id: string): string {
	return id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
}

/**
 * Generic normalized-index lookup: exact slug → normalized slug → fuzzy
 * prefix overlap. Handles routing suffixes (`:nitro`, `@date`, `-YYYYMMDD`)
 * and maker prefixes (e.g. `tencent/hy3-preview:nitro` → `hy3-preview`).
 */
function findInIndex<T>(id: string, index: Map<string, T>): T | undefined {
	const stripped = stripPrefix(id);
	const direct = index.get(stripped) ?? index.get(normalize(stripped));
	if (direct) return direct;
	const norm = normalize(stripped);
	for (const [key, value] of index) {
		if (key.startsWith(norm) || norm.startsWith(key)) return value;
	}
	return undefined;
}

export function lookupInIndex(
	id: string,
	index: Map<string, ModelsDevModel>,
): ModelsDevModel | undefined {
	return findInIndex(id, index);
}

function toModelsDevModel(g: ModelGrepModel): ModelsDevModel {
	return {
		id: slugOf(g.id),
		name: g.name,
		reasoning: g.capabilities?.reasoning,
		modalities: g.modality,
		limit: { context: g.context_length, output: g.max_output },
		cost: { input: g.pricing?.input, output: g.pricing?.output, cache_read: g.pricing?.cache_read },
	};
}

export function buildModelsDevIndex(source: ModelGrepModel[]): Map<string, ModelsDevModel> {
	const index = new Map<string, ModelsDevModel>();
	for (const g of source) {
		const m = toModelsDevModel(g);
		if (!index.has(m.id)) index.set(m.id, m);
		const norm = normalize(m.id);
		if (!index.has(norm)) index.set(norm, m);
	}
	return index;
}

let cachedModelsDevIndex: Map<string, ModelsDevModel> | null = null;
let lastModelsDevSourceRef: ModelGrepModel[] | null = null;

export function getModelsDevIndex(): Map<string, ModelsDevModel> {
	const source = modelgrep.getCached();
	if (cachedModelsDevIndex && lastModelsDevSourceRef === source) {
		return cachedModelsDevIndex;
	}
	cachedModelsDevIndex = buildModelsDevIndex(source);
	lastModelsDevSourceRef = source;
	return cachedModelsDevIndex;
}

export function lookupModelsDev(_provider: string, id: string): ModelsDevModel | undefined {
	// Provider prefix differs between Pi routing (cc/ds/openrouter) and modelgrep
	// (anthropic/tencent), so join on the model slug only via the normalized index.
	return findInIndex(id, getModelsDevIndex());
}

/**
 * Minimal fields from a registered Pi `Model` (or models.json entry). Used to
 * fill catalog gaps for private / gateway models modelgrep never lists
 * (e.g. digitalkode `composer-2.5`).
 */
export type RegisteredModelMeta = {
	id?: string;
	name?: string;
	reasoning?: boolean;
	/** Input modalities when present (`["text"]`, `["text","image"]`). */
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		cache_read?: number;
		cache_write?: number;
	};
};

/** True when cost carries at least one known rate (incl. free `0`). */
function costKnown(cost: ModelsDevModel["cost"] | undefined): boolean {
	if (!cost) return false;
	return cost.input != null || cost.output != null;
}

/** Map a registered Pi model into the shared ModelsDevModel shape. */
export function fromRegisteredModel(
	reg: RegisteredModelMeta | undefined | null,
): ModelsDevModel | undefined {
	if (!reg) return undefined;
	const hasCost = costKnown(reg.cost as ModelsDevModel["cost"]);
	if (!reg.id && !reg.name && reg.contextWindow == null && !hasCost) return undefined;

	const id = reg.id ? slugOf(reg.id) : "unknown";
	const entry: ModelsDevModel = { id };
	if (reg.name) entry.name = reg.name;
	if (reg.reasoning != null) entry.reasoning = reg.reasoning;
	if (reg.input?.length) entry.modalities = { input: reg.input };
	if (reg.contextWindow != null || reg.maxTokens != null) {
		entry.limit = {
			context: reg.contextWindow,
			output: reg.maxTokens,
		};
	}
	if (hasCost) {
		entry.cost = {
			input: reg.cost?.input,
			output: reg.cost?.output,
			cache_read: reg.cost?.cacheRead ?? reg.cost?.cache_read,
			cache_write: reg.cost?.cacheWrite ?? reg.cost?.cache_write,
		};
	}
	return entry;
}

/**
 * Prefer modelgrep catalog fields; fill missing cost/context from a registered
 * Pi model so private gateways still show real $/1M rates in footer + picker.
 */
export function mergeModelsDev(
	catalog: ModelsDevModel | undefined,
	registered: RegisteredModelMeta | undefined | null,
): ModelsDevModel | undefined {
	const reg = fromRegisteredModel(registered);
	if (!catalog) return reg;
	if (!reg) return catalog;

	const cost = costKnown(catalog.cost) ? catalog.cost : reg.cost;
	const context = catalog.limit?.context ?? reg.limit?.context;
	const output = catalog.limit?.output ?? reg.limit?.output;
	const limit =
		context != null || output != null ? { context, output } : (catalog.limit ?? reg.limit);

	return {
		...reg,
		...catalog,
		id: catalog.id || reg.id,
		name: catalog.name ?? reg.name,
		reasoning: catalog.reasoning ?? reg.reasoning,
		modalities: catalog.modalities ?? reg.modalities,
		limit,
		cost,
	};
}

/** Catalog lookup + registered-model fallback (cost/context). */
export function resolveModelsDev(
	provider: string,
	id: string,
	registered?: RegisteredModelMeta | null,
): ModelsDevModel | undefined {
	return mergeModelsDev(lookupModelsDev(provider, id), registered);
}

export async function fetchModelsDevIndex(): Promise<Map<string, ModelsDevModel>> {
	return buildModelsDevIndex(await modelgrep.get());
}

// ── Coding score ──────────────────────────────────────────────────────────────

/**
 * The headline score: the Artificial Analysis Coding Index (0–100), a real
 * coding score. Primary source is modelgrep's `benchmarks.artificial_analysis.
 * coding`; when that's null AND a user has set AA_API_KEY, we fall back to
 * Artificial Analysis's first-party `artificial_analysis_coding_index`.
 *
 * We deliberately do NOT substitute the Intelligence Index or a heuristic
 * blend — those are general-intelligence proxies, not coding scores. A model
 * without a measured coding index scores null and sinks to the unscored tier,
 * which is honest: "we have no coding benchmark for this model."
 */
function codingScore(g: ModelGrepModel, aaByNorm: Map<string, AAFreeModel>): number | null {
	const aa = g.benchmarks?.artificial_analysis;
	if (aa?.coding != null) return Math.round(aa.coding);

	// AA first-party fallback (only populated when AA_API_KEY is set).
	const slug = slugOf(g.id);
	const aaModel = aaByNorm.get(normalize(slug)) ?? findInIndex(slug, aaByNorm as Map<string, AAFreeModel>);
	const aaCoding = aaModel?.evaluations?.artificial_analysis_coding_index;
	return aaCoding == null ? null : Math.round(aaCoding);
}

/** Build the AA fallback index once per buildBenchIndex() call. */
function buildAAIndex(): Map<string, AAFreeModel> {
	const index = new Map<string, AAFreeModel>();
	for (const m of artificialAnalysis.getCached()) {
		const key = m.slug ? normalize(m.slug) : m.name ? normalize(m.name) : null;
		if (!key) continue;
		if (!index.has(key)) index.set(key, m);
	}
	return index;
}

function buildBenchIndex(): Map<string, BenchmarkEntry> {
	const index = new Map<string, BenchmarkEntry>();
	const aaByNorm = buildAAIndex();

	// Rank by coding score (desc); unscored sink to the bottom, holding source
	// order among themselves (modelgrep already returns coding-sorted, so this
	// is stable).
	const scored = modelgrep.getCached().map((g) => ({ g, score: codingScore(g, aaByNorm) }));
	scored.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
	scored.forEach(({ g, score }, i) => {
		const slug = slugOf(g.id);
		const entry: BenchmarkEntry = {
			rank: i + 1,
			model: g.name ?? g.id,
			creator: g.id.split("/")[0] ?? "",
			overallScore: score,
			categoryScores: g.benchmarks?.artificial_analysis
				? { coding: g.benchmarks.artificial_analysis.coding ?? null }
				: undefined,
			inputPrice: g.pricing?.input ?? null,
			outputPrice: g.pricing?.output ?? null,
		};
		for (const k of [slug, normalize(slug)]) if (!index.has(k)) index.set(k, entry);
	});

	// AA-only models: modelgrep never lists them, so the loop above never
	// indexed them — but they're real, scorable models (e.g. GPT-5.6 Terra
	// Medium). Without this, findInIndex would fuzzy-prefix-match them to an
	// unrelated modelgrep entry and report the wrong coding score. Index each
	// AA-only model with its own first-party coding score (no fuzzy fallback:
	// exact slug key only, so we never shadow a modelgrep entry).
	for (const m of artificialAnalysis.getCached()) {
		const slug = m.slug;
		if (!slug) continue;
		const norm = normalize(slug);
		if (index.has(norm)) continue; // modelgrep already scores this model
		const coding = m.evaluations?.artificial_analysis_coding_index;
		if (coding == null) continue; // no coding score to index
		const entry: BenchmarkEntry = {
			rank: index.size + 1, // provisional — recomputed below
			model: m.name ?? slug,
			creator: m.model_creator?.slug ?? "",
			overallScore: Math.round(coding),
			categoryScores: { coding: Math.round(coding) },
			inputPrice: m.pricing?.price_1m_input_tokens ?? null,
			outputPrice: m.pricing?.price_1m_output_tokens ?? null,
		};
		for (const k of [slug, norm]) if (!index.has(k)) index.set(k, entry);
	}
	return index;
}

/**
 * Map a coding score (0–100) to a semantic color token.
 *
 * Thresholds calibrated to the AA Coding Index scale, whose ceiling is ~78
 * (claude-opus-5, #1) — NOT the 0–100 intelligence scale the old thresholds
 * were tuned for (80+ success was unreachable). Mirrors benchGrade families:
 *   A-list (≥73, A− and up) → success
 *   B/C (55–72)            → warning
 *   D/F (<55)              → error
 */
export function benchScoreColor(
	score: number | null | undefined,
): "success" | "warning" | "error" | "muted" {
	if (score == null) return "muted";
	if (score >= 73) return "success";
	if (score >= 55) return "warning";
	return "error";
}

let cachedBenchIndex: Map<string, BenchmarkEntry> | null = null;
let lastBenchModelGrepRef: ModelGrepModel[] | null = null;
let lastBenchAARef: AAFreeModel[] | null = null;

export function getBenchIndex(): Map<string, BenchmarkEntry> {
	const mg = modelgrep.getCached();
	const aa = artificialAnalysis.getCached();
	if (cachedBenchIndex && lastBenchModelGrepRef === mg && lastBenchAARef === aa) {
		return cachedBenchIndex;
	}
	cachedBenchIndex = buildBenchIndex();
	lastBenchModelGrepRef = mg;
	lastBenchAARef = aa;
	return cachedBenchIndex;
}

export function lookupBenchmark(modelName: string): BenchmarkEntry | undefined {
	return findInIndex(modelName, getBenchIndex());
}
