import type { Metadata } from "next";
import { createCanonicalMetadata } from "@/lib/seo";
import { Compass, Languages, PlayCircle, ShieldCheck } from "lucide-react";

export const metadata: Metadata = createCanonicalMetadata("/about", {
  title: "About",
  description:
    "Learn about Hindi Anime, a place to discover anime series and movies with Hindi and other language options.",
});

const features = [
  {
    icon: Compass,
    title: "Discover your next series",
    body: "Browse anime series and movies, explore genres, and find something new to watch with a catalog built for anime fans.",
  },
  {
    icon: Languages,
    title: "Explore language options",
    body: "Find titles with Hindi, Tamil, Telugu, English, Japanese, and other available audio or subtitle options.",
  },
  {
    icon: PlayCircle,
    title: "Choose a watch option",
    body: "When a title has a working source, use the available player options. Availability can vary by title and by third-party provider.",
  },
];

export default function AboutPage() {
  return (
    <main className="container-page py-12 md:py-20">
      <section className="relative overflow-hidden rounded-3xl border border-border-line bg-gradient-to-br from-green-primary/15 via-surface to-surface-dark p-7 md:p-12">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-green-bright/10 blur-3xl" />
        <div className="relative max-w-3xl">
          <span className="eyebrow text-sm text-green-light">ABOUT HINDI ANIME</span>
          <h1 className="font-display mt-3 text-3xl font-extrabold tracking-tight text-text-primary md:text-5xl">
            Anime discovery, made easier.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-text-secondary md:text-lg">
            Hindi Anime helps fans discover anime series and movies, explore language options,
            and find available ways to watch—all in one place.
          </p>
        </div>
      </section>

      <section className="mt-12 md:mt-16" aria-labelledby="about-features-title">
        <div className="max-w-2xl">
          <h2 id="about-features-title" className="font-display text-2xl font-bold text-text-primary md:text-3xl">
            Made for the way you watch
          </h2>
          <p className="mt-3 leading-7 text-text-muted">
            Browse at your own pace, keep track of titles you like, and check the language and
            source details available for each anime.
          </p>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-border-line bg-surface p-6 transition-colors hover:border-green-bright/30"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-green-bright/20 bg-green-primary/10">
                <feature.icon className="h-5 w-5 text-green-bright" aria-hidden="true" />
              </div>
              <h3 className="font-display mt-5 text-lg font-bold text-text-primary">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-text-muted">{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <aside className="mt-10 flex gap-4 rounded-2xl border border-border-line bg-surface-dark p-5 md:mt-12 md:p-6">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-green-light" aria-hidden="true" />
        <div>
          <h2 className="font-display font-bold text-text-primary">About video availability</h2>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            Hindi Anime does not host video files. Playback sources are provided by third-party
            services, so availability and performance may change. Please contact us if you spot
            an incorrect listing or a source that needs attention.
          </p>
        </div>
      </aside>
    </main>
  );
}
