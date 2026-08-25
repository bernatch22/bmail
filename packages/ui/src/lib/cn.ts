/**
 * cn.ts — Tailwind class combiner.
 *
 * clsx merges the conditional class inputs; tailwind-merge resolves
 * conflicting utilities so a caller's override actually wins.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
