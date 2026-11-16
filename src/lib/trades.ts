export const TRADES = ["plumber", "electrician", "carpenter", "roofer", "painter", "general"] as const;
export type Trade = (typeof TRADES)[number];

/** Sensible starting job types per trade, so onboarding is one click. */
export const DEFAULT_JOB_TYPES: Record<Trade, { name: string; description: string; needsBefaring?: boolean }[]> = {
  plumber: [
    { name: "Vannlekkasje", description: "Lekkasje fra rør, kran eller bereder. Kan være akutt." },
    { name: "Bad og våtrom", description: "Nytt bad eller oppussing av våtrom." },
    { name: "Varmtvannsbereder", description: "Bytte eller service av bereder." },
    { name: "Tett avløp/sluk", description: "Tette rør, sluk eller toalett." },
    { name: "Kjøkken – vann og avløp", description: "Tilkobling av oppvaskmaskin, kran, vask." },
  ],
  electrician: [
    { name: "Feilsøking", description: "Strømbrudd, jordfeil, sikringer som går." },
    { name: "Sikringsskap", description: "Oppgradering eller bytte av sikringsskap." },
    { name: "Elbillader", description: "Montering av ladeboks." },
    { name: "Nytt anlegg/rehabilitering", description: "Nybygg, tilbygg eller oppgradering." },
    { name: "Varmekabler", description: "Gulvvarme i bad, gang eller stue." },
  ],
  carpenter: [
    { name: "Tilbygg", description: "Tilbygg, påbygg eller garasje." },
    { name: "Terrasse", description: "Ny terrasse, platting eller rekkverk." },
    { name: "Kjøkken", description: "Montering av kjøkken." },
    { name: "Vinduer og dører", description: "Bytte av vinduer, dører eller terrassedør." },
    { name: "Rehabilitering", description: "Oppussing og rehabilitering innvendig." },
  ],
  roofer: [
    { name: "Taklekkasje", description: "Lekkasje fra tak. Kan være akutt." },
    { name: "Nytt tak", description: "Omlegging av tak, takstein eller takpapp." },
    { name: "Takrenner og nedløp", description: "Bytte eller reparasjon." },
    { name: "Takinspeksjon", description: "Tilstandsvurdering av tak." },
  ],
  painter: [
    { name: "Innvendig maling", description: "Vegger, tak, listverk." },
    { name: "Utvendig maling", description: "Fasade og vinduer." },
    { name: "Tapetsering og sparkling", description: "" },
  ],
  general: [
    { name: "Reparasjon", description: "" },
    { name: "Oppussing", description: "" },
    { name: "Nybygg/tilbygg", description: "" },
  ],
};
