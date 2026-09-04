"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { PosterArt } from "@/components/anime/PosterArt";
import { LanguageBadges } from "@/components/anime/LanguageBadges";
import {
  Clock,
  Calendar,
  Globe,
  Play,
  Bell,
  Check,
  Search,
} from "lucide-react";
import { weekDays, getScheduleByDay } from "@/lib/mock/schedule";
import { languages } from "@/lib/mock/languages";
import type { WeekDay } from "@/types/schedule";
import { cn } from "@/lib/utils";

const TIMEZONES = [
  { label: "IST (India +5:30)", value: "IST", offset: 0 },
  { label: "JST (Japan +9:00)", value: "JST", offset: 3.5 },
  { label: "UTC (GMT +0:00)", value: "UTC", offset: -5.5 },
  { label: "EST (US East -5:00)", value: "EST", offset: -10.5 },
  { label: "PST (US West -8:00)", value: "PST", offset: -13.5 },
];

function convertTime(timeStr: string, offsetHours: number): string {
  if (offsetHours === 0) return timeStr;
  const [hours, minutes] = timeStr.split(":").map(Number);
  let totalMinutes = hours * 60 + minutes + Math.round(offsetHours * 60);
  if (totalMinutes < 0) totalMinutes += 24 * 60;
  totalMinutes %= 24 * 60;
  const newHours = Math.floor(totalMinutes / 60);
  const newMinutes = totalMinutes % 60;
  return `${String(newHours).padStart(2, "0")}:${String(newMinutes).padStart(2, "0")}`;
}

export default function SchedulePage() {
  // Get today's day of week
  const todayDayName = useMemo<WeekDay>(() => {
    const dayNames: WeekDay[] = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const todayIndex = new Date().getDay();
    return dayNames[todayIndex] || "Monday";
  }, []);

  const [activeDay, setActiveDay] = useState<WeekDay>(todayDayName);
  const [timezone, setTimezone] = useState("IST");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "released" | "upcoming">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [reminders, setReminders] = useState<Record<string, boolean>>({});

  const currentTzOffset = useMemo(() => {
    return TIMEZONES.find((t) => t.value === timezone)?.offset || 0;
  }, [timezone]);

  // Toggle reminder
  function toggleReminder(id: string) {
    setReminders((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Get raw schedule for the day
  const rawEntries = useMemo(() => getScheduleByDay(activeDay), [activeDay]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return rawEntries.filter((entry) => {
      if (selectedLanguage && !entry.languages.includes(selectedLanguage as never)) {
        return false;
      }
      if (statusFilter !== "all" && entry.status !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          entry.animeTitle.toLowerCase().includes(q) ||
          String(entry.episodeNumber).includes(q)
        );
      }
      return true;
    });
  }, [rawEntries, selectedLanguage, statusFilter, searchQuery]);

  return (
    <div className="container-page py-10 md:py-14">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border-line bg-gradient-to-br from-surface via-surface-dark to-background p-6 sm:p-8">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-green-primary/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-green-primary/30 bg-green-primary/10 px-3 py-1 text-xs font-semibold text-green-light">
              <Calendar className="h-3.5 w-3.5" />
              <span>Broadcast Timetable</span>
            </div>
            <h1 className="font-display mt-3 text-3xl font-extrabold text-text-primary sm:text-4xl">
              Weekly Release Schedule
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              Never miss a simulcast or new dubbed episode drop. Times are automatically adjusted to
              your preferred timezone.
            </p>
          </div>

          {/* Timezone Selector */}
          <div className="flex flex-col gap-1.5 sm:items-end">
            <label className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
              <Globe className="h-3.5 w-3.5 text-green-light" />
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="rounded-lg border border-border-line bg-surface px-3 py-2 text-xs font-semibold text-text-primary focus:border-green-primary focus:outline-none"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Weekday Switcher Tabs */}
      <div className="mt-8">
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-2">
          {weekDays.map((day) => {
            const isSelected = activeDay === day;
            const isToday = day === todayDayName;
            const count = getScheduleByDay(day).length;

            return (
              <button
                key={day}
                type="button"
                onClick={() => setActiveDay(day)}
                className={cn(
                  "relative flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all whitespace-nowrap",
                  isSelected
                    ? "border-green-bright bg-green-primary/20 text-green-light shadow-[0_0_16px_-4px_rgba(34,197,94,0.5)]"
                    : "border-border-line bg-surface text-text-secondary hover:border-green-primary/60 hover:text-white"
                )}
              >
                <span>{day}</span>
                {isToday && (
                  <span className="rounded bg-green-primary px-1.5 py-0.5 text-[10px] font-bold text-black uppercase tracking-wider">
                    Today
                  </span>
                )}
                <span className="text-xs text-text-muted">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border-line pb-6">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <div className="flex rounded-lg border border-border-line bg-surface p-1">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                statusFilter === "all" ? "bg-green-primary text-black" : "text-text-secondary hover:text-white"
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("released")}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                statusFilter === "released" ? "bg-green-primary text-black" : "text-text-secondary hover:text-white"
              )}
            >
              Released
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("upcoming")}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                statusFilter === "upcoming" ? "bg-green-primary text-black" : "text-text-secondary hover:text-white"
              )}
            >
              Upcoming
            </button>
          </div>

          {/* Language filter */}
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            className="rounded-lg border border-border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary focus:border-green-primary focus:outline-none"
          >
            <option value="">All Audio Languages</option>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {/* Search within day */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder={`Search ${activeDay}'s anime...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border-line bg-surface py-1.5 pl-9 pr-3 text-xs text-text-primary placeholder:text-text-muted focus:border-green-primary focus:outline-none"
          />
        </div>
      </div>

      {/* Schedule Entries List */}
      <div className="mt-8">
        {filteredEntries.length > 0 ? (
          <div className="flex flex-col divide-y divide-border-line rounded-2xl border border-border-line bg-surface overflow-hidden">
            {filteredEntries.map((entry) => {
              const displayTime = convertTime(entry.time, currentTzOffset);
              const isReminded = reminders[entry.id];
              const isUpcoming = entry.status === "upcoming";

              return (
                <div
                  key={entry.id}
                  className="group flex flex-col gap-4 p-4 transition-colors hover:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between"
                >
                  {/* Left: Time & Poster */}
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex w-24 shrink-0 flex-col items-start gap-1">
                      <span className="flex items-center gap-1.5 font-mono text-sm font-bold text-green-light sm:text-base">
                        <Clock className="h-3.5 w-3.5" />
                        {displayTime}
                      </span>
                      <span className="text-[10px] uppercase font-semibold text-text-muted">
                        {timezone}
                      </span>
                    </div>

                    <Link
                      href={`/anime/${entry.animeSlug}`}
                      className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg border border-border-line transition-transform group-hover:scale-105"
                    >
                      <PosterArt seed={entry.poster} title={entry.animeTitle} fillContainer showOverlay={false} showSprocket={false} />
                    </Link>

                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/anime/${entry.animeSlug}`}
                        className="truncate font-display text-base font-bold text-text-primary group-hover:text-green-light block"
                      >
                        {entry.animeTitle}
                      </Link>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Episode {entry.episodeNumber} Broadcast
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <LanguageBadges languages={entry.languages} max={3} />
                      </div>
                    </div>
                  </div>

                  {/* Right: Status & Actions */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 border-t border-border-line/40 pt-3 sm:border-0 sm:pt-0">
                    <div className="flex items-center gap-2">
                      {isUpcoming ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-xs font-semibold text-yellow-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
                          Upcoming
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-green-primary/30 bg-green-primary/10 px-2.5 py-1 text-xs font-semibold text-green-light">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-bright" />
                          Aired
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isUpcoming ? (
                        <button
                          type="button"
                          onClick={() => toggleReminder(entry.id)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all",
                            isReminded
                              ? "border-green-bright bg-green-primary/20 text-green-light"
                              : "border-border-line bg-surface text-text-secondary hover:border-green-primary/60 hover:text-white"
                          )}
                        >
                          {isReminded ? (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              Reminder Set
                            </>
                          ) : (
                            <>
                              <Bell className="h-3.5 w-3.5" />
                              Remind Me
                            </>
                          )}
                        </button>
                      ) : (
                        <Link
                          href={`/anime/${entry.animeSlug}`}
                          className="flex items-center gap-1.5 rounded-lg bg-green-primary px-3 py-1.5 text-xs font-bold text-black shadow-md transition-all hover:bg-green-bright active:scale-95"
                        >
                          <Play className="h-3.5 w-3.5 fill-black" />
                          Watch Now
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border-line py-16 text-center">
            <Calendar className="h-10 w-10 text-text-muted" />
            <div>
              <p className="font-display text-lg font-bold text-text-primary">
                No scheduled episodes found
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Try clearing your search query or language filters for {activeDay}.
              </p>
            </div>
            {(searchQuery || selectedLanguage || statusFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedLanguage("");
                  setStatusFilter("all");
                }}
                className="mt-2 text-xs font-semibold text-green-light hover:underline"
              >
                Reset Filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
