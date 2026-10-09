import type { Language } from "@/types/language";

export const languages: Language[] = [
  { code: "hindi", label: "Hindi", shortLabel: "HIN" },
  { code: "tamil", label: "Tamil", shortLabel: "TAM" },
  { code: "telugu", label: "Telugu", shortLabel: "TEL" },
  { code: "english", label: "English", shortLabel: "ENG" },
  { code: "japanese", label: "Japanese", shortLabel: "JPN" },
];

export function getLanguageLabel(code: string) {
  return languages.find((l) => l.code === code)?.label ?? code;
}
