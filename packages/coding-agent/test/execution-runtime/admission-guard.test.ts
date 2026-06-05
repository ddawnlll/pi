import { afterEach, describe, expect, it } from "vitest";
import {
	guardExecutionEntrypoint,
	listAdmissionDecisions,
	resetAdmissionDecisions,
} from "../../src/execution-runtime/admission-guard.js";

describe("admission-guard", () => {
	afterEach(() => resetAdmissionDecisions());

	it("persists allow decisions for covered entrypoints", () => {
		const record = guardExecutionEntrypoint("cli_plan_run", {
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: true,
			autonomousMode: true,
			promotionGateSatisfied: true,
		});
		expect(record.decision).toBe("allow");
		expect(listAdmissionDecisions()).toHaveLength(1);
	});

	it("rejects production json fallback and records reason", () => {
		const record = guardExecutionEntrypoint("dashboard_run", {
			postgresAvailable: true,
			production: true,
			jsonFallback: true,
			repairMode: true,
			autonomousMode: true,
			promotionGateSatisfied: true,
		});
		expect(record.decision).toBe("reject");
		expect(record.reason).toBe("json_fallback_forbidden_in_production");
	});
});
