function parseJsonPayload(payload: string): unknown {
	try {
		return JSON.parse(payload);
	} catch {
		return undefined;
	}
}

function textFromObject(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") return undefined;

	const record = value as Record<string, unknown>;
	if (typeof record.text === "string") return record.text;
	if (typeof record.textDelta === "string") return record.textDelta;
	if (typeof record.delta === "string") return record.delta;

	if (Array.isArray(record.choices)) {
		return record.choices
			.map((choice) => {
				if (!choice || typeof choice !== "object") return "";
				const choiceRecord = choice as Record<string, unknown>;
				if (typeof choiceRecord.text === "string") return choiceRecord.text;
				if (choiceRecord.delta && typeof choiceRecord.delta === "object") {
					const delta = choiceRecord.delta as Record<string, unknown>;
					return typeof delta.content === "string" ? delta.content : "";
				}
				return "";
			})
			.join("");
	}

	if (Array.isArray(record.content)) {
		return record.content
			.map((part) => {
				if (!part || typeof part !== "object") return "";
				const partRecord = part as Record<string, unknown>;
				return typeof partRecord.text === "string" ? partRecord.text : "";
			})
			.join("");
	}

	return undefined;
}

function textFromPayload(payload: string): string | undefined {
	if (!payload || payload === "[DONE]") return undefined;

	const aiSdkDataStream = payload.match(/^(\d+):(.*)$/s);
	if (aiSdkDataStream) {
		const [, code, encoded] = aiSdkDataStream;
		if (code !== "0") return undefined;
		return textFromObject(parseJsonPayload(encoded));
	}

	return textFromObject(parseJsonPayload(payload));
}

export function extractAssistantTextFromStream(raw: string): string {
	const chunks: string[] = [];

	for (const originalLine of raw.split(/\r?\n/)) {
		const line = originalLine.trim();
		if (!line || line.startsWith("event:")) continue;
		const payload = line.startsWith("data:") ? line.slice("data:".length).trim() : line;
		const text = textFromPayload(payload);
		if (text) chunks.push(text);
	}

	return chunks.join("").trim();
}
