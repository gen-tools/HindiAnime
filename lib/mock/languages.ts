import type { Language } from "@/types/language";

export const languages: Language[] = [
  { code: "hindi", label: "Hindi", shortLabel: "HIN" },
  { code: "tamil", label: "Tamil", shortLabel: "TAM" },
  { code: "telugu", label: "Telugu", shortLabel: "TEL" },
  { code: "english", label: "English", shortLabel: "ENG" },
  { code: "japanese", label: "Japanese", shortLabel: "JPN" },
  { code: "korean", label: "Korean", shortLabel: "KOR" },
  { code: "malayalam", label: "Malayalam", shortLabel: "MAL" },
  { code: "kannada", label: "Kannada", shortLabel: "KAN" },
  { code: "bengali", label: "Bengali", shortLabel: "BEN" },
  { code: "marathi", label: "Marathi", shortLabel: "MAR" },
];

export function getLanguageLabel(code: string) {
  return languages.find((l) => l.code === code)?.label ?? code;
}
