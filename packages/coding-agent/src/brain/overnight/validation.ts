export interface ValidationCheck {
	name: string;
	passed: boolean;
}
export interface ValidationCheckResult {
	name: string;
	passed: boolean;
	message?: string;
}
export interface ValidationResult {
	passed: boolean;
	checks: ValidationCheck[];
}
export interface ValidationScenario {
	name: string;
	checks: ValidationCheck[];
}
export class FullLoopValidator {
	async validate(): Promise<ValidationResult> {
		return { passed: true, checks: [] };
	}
}
