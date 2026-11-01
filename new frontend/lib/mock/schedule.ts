import type { ScheduleEntry, WeekDay } from "@/types/schedule";
import { anime } from "./anime";

export const weekDays: WeekDay[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const timeSlots = ["17:00", "18:30", "19:45", "21:00", "22:15", "23:30"];

function buildSchedule(): ScheduleEntry[] {
  const ongoing = anime.filter((a) => a.type === "TV");
  const entries: ScheduleEntry[] = [];

  weekDays.forEach((day, dayIndex) => {
    // Select 4-5 anime for each day
    const dayAnime = ongoing.filter((_, idx) => idx % 7 === dayIndex || (idx + 3) % 7 === dayIndex);

    dayAnime.slice(0, 5).forEach((a, slotIdx) => {
      const epNumber = Math.max(1, ((a.episodeCount || 12) - (dayIndex * 2 + slotIdx)) % (a.episodeCount || 12) + 1);
      const isUpcoming = dayIndex > 4 || (dayIndex === 5 && slotIdx > 2);

      entries.push({
        id: `${a.slug}-${day.toLowerCase()}-slot${slotIdx}`,
        animeSlug: a.slug,
        animeTitle: a.title,
        poster: a.poster,
        episodeNumber: epNumber,
        time: timeSlots[slotIdx % timeSlots.length],
        day,
        languages: a.languages,
        status: isUpcoming ? "upcoming" : "released",
      });
    });
  });

  return entries;
}

export const schedule = buildSchedule();

export function getScheduleByDay(day: WeekDay) {
  return schedule
    .filter((s) => s.day === day)
    .sort((a, b) => a.time.localeCompare(b.time));
}
