export function routeLegacyStateWrite(featureFlag: "observe" | "enforce", mutate: () => void): string {
	mutate();
	return featureFlag === "observe" ? "legacy_state_write_detected" : "controller_event_routed";
}
