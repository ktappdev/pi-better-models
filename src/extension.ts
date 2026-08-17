import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { prefetchModelData } from "./data.ts";
import modelPickerExtension from "./models.ts";
import { once } from "./once.ts";

export default function (pi: ExtensionAPI): void {
	once(pi, "pix-models", () => {
		modelPickerExtension(pi);
		// Pre-warm model data in background so /models opens instantly
		void prefetchModelData();
	});
}
