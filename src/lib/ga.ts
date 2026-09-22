// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const DEFAULT_GA_MEASUREMENT_ID = 'G-M9EMDYHBPE';

/** GA4 measurement ID. Public by design; override with PUBLIC_GA_MEASUREMENT_ID. */
export function gaMeasurementId(): string {
  const raw = import.meta.env.PUBLIC_GA_MEASUREMENT_ID ?? DEFAULT_GA_MEASUREMENT_ID;
  return /^G-[A-Z0-9]+$/.test(raw) ? raw : '';
}
