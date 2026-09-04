export type LanguageCode =
  | "hindi"
  | "tamil"
  | "telugu"
  | "english"
  | "japanese"
  | "korean"
  | "malayalam"
  | "kannada"
  | "bengali"
  | "marathi";

export interface Language {
  code: LanguageCode;
  label: string;
  shortLabel: string;
}
