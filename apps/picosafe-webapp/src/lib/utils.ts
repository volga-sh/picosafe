import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind CSS classes with proper precedence handling
 *
 * Combines clsx for conditional classes and tailwind-merge for deduplication
 *
 * @param inputs - Class names to merge
 * @returns Merged class string
 * @example
 * cn("px-2 py-1", "px-4") // Returns "py-1 px-4"
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
