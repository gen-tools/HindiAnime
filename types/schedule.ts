import type { LanguageCode } from "./language";

export type WeekDay =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export interface ScheduleEntry {
  id: string;
  animeSlug: string;
  animeTitle: string;
  poster: string;
  episodeNumber: number;
  time: string;
  day: WeekDay;
  languages: LanguageCode[];
  status: "upcoming" | "released";
}
