import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Parses WhatsApp file names like "PTT-20231023-WA0001.opus" to a Date object
export function parseWhatsAppDate(fileName: string): Date | undefined {
  const match = fileName.match(/-(20\d{2})(\d{2})(\d{2})-WA/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // 0-indexed month
    const day = parseInt(match[3], 10);
    return new Date(year, month, day);
  }
  return undefined;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}
