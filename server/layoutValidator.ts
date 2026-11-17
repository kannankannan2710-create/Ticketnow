import type { LayoutValidationIssue, ScreenLayoutV2 } from '../src/types.ts';
import {
  validateScreenLayoutJsonText,
  validateScreenLayoutObject,
  type DetailedLayoutValidationResult,
} from '../src/lib/layoutJsonValidator.ts';

export interface LayoutValidationResult {
  valid: boolean;
  errors: string[];
  issues: LayoutValidationIssue[];
  normalized?: ScreenLayoutV2;
}

export { validateScreenLayoutJsonText, validateScreenLayoutObject };
export type { DetailedLayoutValidationResult };

export function validateScreenLayoutV2(
  raw: unknown,
  options?: { requireBlockedSeats?: boolean }
): LayoutValidationResult {
  const res = validateScreenLayoutObject(raw, {
    requireBlockedSeats: options?.requireBlockedSeats ?? false,
  });
  return {
    valid: res.valid,
    errors: res.errors,
    issues: res.issues,
    normalized: res.parsed,
  };
}
