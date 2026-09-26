const unsafeAttributionControlPattern = /[\p{Cc}\u2028\u2029]/u;

export const safeAttributionText = (value: string): string =>
  unsafeAttributionControlPattern.test(value) ? '' : value;
