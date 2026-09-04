import type { LanguageCode } from "./language";

export interface Episode {
  id: string;
  animeSlug: string;
  animeTitle: string;
  animePoster: string;
  season: number;
  number: number;
  title: string;
  thumbnail: string;
  durationMinutes: number;
  languages: LanguageCode[];
  releasedAt: string;
  isNew?: boolean;
}
