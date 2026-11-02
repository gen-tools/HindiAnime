export type SupportedLanguageCode =
  | "hindi"
  | "tamil"
  | "telugu"
  | "english"
  | "japanese";

export type LanguageCode =
  | SupportedLanguageCode
  | "korean"
  | "malayalam"
  | "kannada"
  | "bengali"
  | "marathi";

export interface Language {
  code: SupportedLanguageCode;
  label: string;
  shortLabel: string;
}
