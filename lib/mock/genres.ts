import type { Genre } from "@/types/genre";

export const genres: Genre[] = [
  { slug: "action", label: "Action", description: "High-stakes battles and relentless pace" },
  { slug: "adventure", label: "Adventure", description: "Journeys across vast, uncharted worlds" },
  { slug: "comedy", label: "Comedy", description: "Sharp gags and easy laughs" },
  { slug: "drama", label: "Drama", description: "Character-driven, emotionally heavy arcs" },
  { slug: "fantasy", label: "Fantasy", description: "Magic systems and impossible realms" },
  { slug: "romance", label: "Romance", description: "Slow burns and confessions" },
  { slug: "horror", label: "Horror", description: "Dread, tension, and things in the dark" },
  { slug: "mystery", label: "Mystery", description: "Clues, twists, and reveals" },
  { slug: "sci-fi", label: "Sci-Fi", description: "Technology, space, and speculative futures" },
  { slug: "thriller", label: "Thriller", description: "Tension that never lets up" },
  { slug: "sports", label: "Sports", description: "Rivalries, training arcs, and team grit" },
  { slug: "isekai", label: "Isekai", description: "Ordinary lives dropped into new worlds" },
  { slug: "slice-of-life", label: "Slice of Life", description: "Quiet, grounded, everyday moments" },
  { slug: "shounen", label: "Shounen", description: "Action-packed stories of growth, rivalry, and camaraderie" },
  { slug: "supernatural", label: "Supernatural", description: "Spirits, curses, and otherworldly powers" },
  { slug: "psychological", label: "Psychological", description: "Mind games, suspense, and moral dilemmas" },
  { slug: "school", label: "School", description: "Youth, clubs, and campus life" },
  { slug: "super-power", label: "Super Power", description: "Superhuman abilities and overwhelming might" },
];

export function getGenre(slug: string) {
  return genres.find((g) => g.slug === slug);
}
