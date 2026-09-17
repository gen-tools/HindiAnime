import type { Country, CountryCode } from "@/types/country";
import type { Anime } from "@/types/anime";

export const countries: Country[] = [
  { code: "japan", label: "Japan" },
  { code: "korea", label: "South Korea" },
  { code: "china", label: "China" },
  { code: "india", label: "India" },
  { code: "usa", label: "United States" },
];

export function getCountryLabel(code: string): string {
  const c = countries.find((item) => item.code === code.toLowerCase().trim());
  return c ? c.label : code;
}

// Comprehensive detection lists for countries where API does not provide origin metadata

const KOREAN_KEYWORDS = [
  "solo leveling", "solo-leveling", "lookism", "tower of god", "tower-of-god",
  "god of high school", "the god of high school", "noblesse", "sweet home",
  "viral hit", "omniscience reader", "the boxer", "wind breaker", "bastard",
  "dr frost", "true beauty", "eleceed",
];

const CHINESE_KEYWORDS = [
  "donghua", "link click", "daily life of the immortal king", "immortal king",
  "a mortals journey to immortality", "mortals journey", "journey to immortality",
  "heaven officials blessing", "heaven official",
  "lord of mysteries", "lord of the mysteries", "guimi zhi zhu",
  "the monkey king reborn", "the monkey king", "monkey king",
  "to be hero x", "to be hero",
  "scissor seven", "fog hill of five elements", "fog hill",
  "dragon raja", "scumbag system", "soul land", "battle through the heavens",
  "the kings avatar", "rakshasa street", "throne of seal", "stellar transformations",
  "tales of demons and gods", "mo dao zu shi", "grandmaster of demonic cultivation",
  "swallowed star", "perfect world", "quanzhi fashi", "quanzhi",
  "a will eternal", "lord xue ying", "martial universe", "renegade immortal",
  "shrouding the heavens", "record of a mortal", "white snake", "green snake",
  "nezha", "new gods", "jiang ziya", "deep sea", "bilibili", "tencent",
  "cultivation", "xianxia", "wuxia",
];

const CHINESE_STUDIOS = [
  "bilibili", "tencent", "haoliners", "sparkly key", "foch film", "l2studio",
  "shanghai animation", "colored pencil animation", "b.cmay pictures",
];

const INDIAN_KEYWORDS = [
  "chhota bheem", "chota bheem", "motu patlu", "roll no 21", "little singham",
  "legend of hanuman", "hanuman", "mighty raju", "baahubali", "krishna and kamsa",
  "krishna aayo", "krishna", "mahavatar narsimha", "narsimha", "golmaal junior",
  "fukrey boyzzz", "shiva", "rudra", "dabangg", "singhasan battisi", "vir the robot boy",
];

const INDIAN_STUDIOS = [
  "green gold", "cosmos-maya", "cosmos maya", "toonz animation", "reliance animation",
  "graphic india",
];

const USA_KEYWORDS = [
  // DreamWorks
  "how to train your dragon", "dragon rider", "the bad guys", "bad guys",
  "tales of arcadia", "trollhunters", "3below", "wizards tales of arcadia",
  "shrek", "kung fu panda", "madagascar", "megamind", "the croods", "the boss baby",
  "captain underpants", "puss in boots", "sinbad",
  // DC / Marvel / Warner Bros
  "batman", "superman", "spider-man", "spiderman", "justice league", "avengers",
  "iron man", "x-men", "hulk", "the incredible hulk", "thor", "marvel",
  "watchmen", "teen titans", "bat-fam", "harley quinn", "suicide squad",
  // Nickelodeon / Cartoon Network
  "avatar the last airbender", "legend of korra", "ben 10", "spongebob",
  "the loud house", "loud house", "the amazing world of gumball", "gumball",
  "johnny bravo", "dexter", "powerpuff", "courage the cowardly dog", "generator rex",
  "samurai jack", "adventure time", "regular show", "steven universe", "kim possible",
  "transformers", "transformers prime",
  // Modern Western / Netflix / Adult Animation
  "arcane", "castlevania", "blood of zeus", "rwby", "invincible", "hazbin hotel",
  "helluva boss", "secret level", "scott pilgrim takes off", "scott pilgrim",
  "blue eye samurai", "love death", "love, death", "captain laserhawk",
  "the dragon prince", "dragon prince", "inside job", "disenchantment",
  "rick and morty", "rick & morty", "gravity falls", "the owl house", "owl house",
  "star wars", "the clone wars", "bad batch", "star trek", "lower decks",
  "jurassic world", "maya and the three", "twilight of the gods", "jentry chau",
  "the legend of vox machina", "vox machina", "splinter cell", "murder drones",
  "devil may cry", "oddballs", "wolf king", "agent elvis", "angry birds", "sonic prime",
  "farzar", "tomb raider", "super giant robot brothers", "sausage party",
  "the witcher: nightmare of the wolf", "the witcher nightmare of the wolf",
  "the last kids on earth", "kid cosmic", "he-man", "niko and the sword of light",
  // Western Movie Franchises
  "lilo & stitch", "lilo and stitch", "lilo stitch", "elio", "scooby-doo", "scooby doo",
  "the smurfs", "smurfs", "barbie", "slugterra", "miraculous world", "miraculous",
];

const USA_STUDIOS = [
  "marvel", "dc", "warner", "disney", "pixar", "dreamworks", "powerhouse",
  "nickelodeon", "cartoon network", "hasbro", "mattel", "sony pictures animation",
  "illumination", "blue sky", "laika", "paramount", "blur studio", "rooster teeth",
  "titmouse", "flying bark",
];

function normalizeText(text?: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[-_:]/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesCountry(anime: Anime, countryCode: string): boolean {
  const code = countryCode.toLowerCase().trim();
  if (!code) return true;

  // 1. Direct match if country field is set
  if (anime.country) {
    const ac = anime.country.toLowerCase().trim();
    if (ac === code) return true;
    if (code === "korea" && (ac === "south-korea" || ac === "kr" || ac === "korean")) return true;
    if (code === "china" && (ac === "cn" || ac === "chinese" || ac === "donghua")) return true;
    if (code === "usa" && (ac === "united-states" || ac === "us" || ac === "america")) return true;
    if (code === "india" && (ac === "in" || ac === "indian")) return true;
    if (code === "japan" && (ac === "jp" || ac === "japanese")) return true;
  }

  const normSlug = normalizeText(anime.slug);
  const normTitle = normalizeText(anime.title);
  const normStudio = normalizeText(anime.studio);
  const normGenres = (anime.genres || []).map((g) => normalizeText(g));

  // 2. Korea detection
  if (code === "korea" || code === "south-korea") {
    if (anime.languages?.includes("korean")) return true;
    if (anime.alternativeTitle && /[\uAC00-\uD7AF]/.test(anime.alternativeTitle)) return true;
    if (anime.title && /[\uAC00-\uD7AF]/.test(anime.title)) return true;
    return KOREAN_KEYWORDS.some(
      (kw) => normSlug.includes(kw) || normTitle.includes(kw)
    );
  }

  // 3. China detection
  if (code === "china") {
    if (CHINESE_STUDIOS.some((st) => normStudio.includes(st))) return true;
    if (normGenres.some((g) => g === "donghua" || g === "chinese")) return true;
    return CHINESE_KEYWORDS.some(
      (kw) => normSlug.includes(kw) || normTitle.includes(kw)
    );
  }

  // 4. India detection
  if (code === "india") {
    if (INDIAN_STUDIOS.some((st) => normStudio.includes(st))) return true;
    return INDIAN_KEYWORDS.some(
      (kw) => normSlug.includes(kw) || normTitle.includes(kw)
    );
  }

  // 5. United States detection
  if (code === "usa" || code === "united-states") {
    // Studio match
    if (USA_STUDIOS.some((st) => normStudio.includes(st))) return true;

    // Franchise and keyword match (checks both slug and title)
    if (
      USA_KEYWORDS.some(
        (kw) => normSlug.includes(kw) || normTitle.includes(kw)
      )
    ) {
      return true;
    }

    // Genre indicators (Western animation is frequently tagged as cartoon, family, western)
    // Note: ensure we don't accidentally match Japanese anime like Digimon if they have family
    const isWesternGenre = normGenres.some(
      (g) => g === "cartoon" || g === "western"
    );
    if (isWesternGenre) return true;

    if (normGenres.includes("family")) {
      const isKnownJapanese =
        normSlug.includes("digimon") ||
        normSlug.includes("pokemon") ||
        normSlug.includes("ghibli") ||
        normSlug.includes("doraemon") ||
        normSlug.includes("shinchan");
      if (!isKnownJapanese) {
        return true;
      }
    }

    return false;
  }

  // 6. Japan detection (default origin for traditional anime)
  if (code === "japan") {
    if (
      matchesCountry(anime, "korea") ||
      matchesCountry(anime, "china") ||
      matchesCountry(anime, "india") ||
      matchesCountry(anime, "usa")
    ) {
      return false;
    }
    return true;
  }

  return false;
}

