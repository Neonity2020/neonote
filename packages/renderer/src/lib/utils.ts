import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names, letting a later Tailwind utility win over an earlier one
 * that targets the same CSS property.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
