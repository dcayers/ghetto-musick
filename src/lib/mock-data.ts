import { Genre, Song, Connection } from "@/types/music";

const generateSong = (
  id: string,
  title: string,
  artist: string,
  genre: string,
  tags: string[],
  bpm: number,
  keySignature: string,
  timeSignature: string
): Song => ({
  id,
  title,
  artist,
  genre,
  tags,
  bpm,
  keySignature,
  timeSignature,
});

export const mockGenres: Genre[] = [
  {
    id: "hip-hop",
    name: "Hip-Hop",
    songs: [
      generateSong(
        "hip1",
        "Rapper's Delight",
        "The Sugarhill Gang",
        "hip-hop",
        ["classic", "old school"],
        111,
        "D♭ major",
        "4/4"
      ),
      generateSong(
        "hip2",
        "The Message",
        "Grandmaster Flash",
        "hip-hop",
        ["classic", "conscious"],
        103,
        "F minor",
        "4/4"
      ),
      generateSong(
        "hip3",
        "Planet Rock",
        "Afrika Bambaataa",
        "hip-hop",
        ["electro", "influential"],
        127,
        "D minor",
        "4/4"
      ),
      generateSong(
        "hip4",
        "Walk This Way",
        "Run-DMC",
        "hip-hop",
        ["rock", "crossover"],
        114,
        "E major",
        "4/4"
      ),
      generateSong(
        "hip5",
        "Fight the Power",
        "Public Enemy",
        "hip-hop",
        ["political", "sample-heavy"],
        109,
        "G minor",
        "4/4"
      ),
      // ... (add more hip-hop songs to reach 20-50)
    ],
  },
  {
    id: "electro",
    name: "Electro",
    songs: [
      generateSong(
        "el1",
        "Clear",
        "Cybotron",
        "electro",
        ["techno", "detroit"],
        130,
        "C minor",
        "4/4"
      ),
      generateSong(
        "el2",
        "Nunk",
        "Warp 9",
        "electro",
        ["funk", "space"],
        108,
        "A minor",
        "4/4"
      ),
      generateSong(
        "el3",
        "Jam On It",
        "Newcleus",
        "electro",
        ["funk", "vocoder"],
        111,
        "G major",
        "4/4"
      ),
      generateSong(
        "el4",
        "Rockit",
        "Herbie Hancock",
        "electro",
        ["jazz", "turntablism"],
        111,
        "C minor",
        "4/4"
      ),
      generateSong(
        "el5",
        "Al-Naafiysh (The Soul)",
        "Hashim",
        "electro",
        ["arabic", "breakdance"],
        126,
        "E minor",
        "4/4"
      ),
      // ... (add more electro songs to reach 20-50)
    ],
  },
  {
    id: "techno",
    name: "Techno",
    songs: [
      generateSong(
        "tech1",
        "Strings of Life",
        "Rhythim Is Rhythim",
        "techno",
        ["detroit", "classic"],
        125,
        "D major",
        "4/4"
      ),
      generateSong(
        "tech2",
        "Spastik",
        "Plastikman",
        "techno",
        ["minimal", "acid"],
        133,
        "A minor",
        "4/4"
      ),
      generateSong(
        "tech3",
        "Jaguar",
        "DJ Rolando",
        "techno",
        ["underground resistance", "detroit"],
        132,
        "C minor",
        "4/4"
      ),
      generateSong(
        "tech4",
        "Windowlicker",
        "Aphex Twin",
        "techno",
        ["idm", "experimental"],
        126,
        "C♯ minor",
        "4/4"
      ),
      generateSong(
        "tech5",
        "Sandstorm",
        "Darude",
        "techno",
        ["trance", "anthem"],
        136,
        "B minor",
        "4/4"
      ),
      // ... (add more techno songs to reach 20-50)
    ],
  },
  {
    id: "house",
    name: "House",
    songs: [
      generateSong(
        "house1",
        "Move Your Body",
        "Marshall Jefferson",
        "house",
        ["chicago", "piano"],
        122,
        "D minor",
        "4/4"
      ),
      generateSong(
        "house2",
        "Can You Feel It",
        "Mr. Fingers",
        "house",
        ["deep", "chicago"],
        120,
        "A minor",
        "4/4"
      ),
      generateSong(
        "house3",
        "French Kiss",
        "Lil Louis",
        "house",
        ["acid", "erotic"],
        124,
        "G minor",
        "4/4"
      ),
      generateSong(
        "house4",
        "Pump Up The Volume",
        "M|A|R|R|S",
        "house",
        ["sample", "uk"],
        121,
        "A minor",
        "4/4"
      ),
      generateSong(
        "house5",
        "Your Love",
        "Frankie Knuckles",
        "house",
        ["chicago", "classic"],
        120,
        "F major",
        "4/4"
      ),
      // ... (add more house songs to reach 20-50)
    ],
  },
  {
    id: "urban",
    name: "Urban",
    songs: [
      generateSong(
        "urb1",
        "No Scrubs",
        "TLC",
        "urban",
        ["r&b", "90s"],
        93,
        "G minor",
        "4/4"
      ),
      generateSong(
        "urb2",
        "Poison",
        "Bell Biv DeVoe",
        "urban",
        ["new jack swing", "90s"],
        112,
        "C♯ minor",
        "4/4"
      ),
      generateSong(
        "urb3",
        "U Got It Bad",
        "Usher",
        "urban",
        ["r&b", "2000s"],
        72,
        "C minor",
        "4/4"
      ),
      generateSong(
        "urb4",
        "Crazy In Love",
        "Beyoncé",
        "urban",
        ["pop", "r&b"],
        99,
        "D minor",
        "4/4"
      ),
      generateSong(
        "urb5",
        "In Da Club",
        "50 Cent",
        "urban",
        ["hip-hop", "2000s"],
        90,
        "E♭ minor",
        "4/4"
      ),
      // ... (add more urban songs to reach 20-50)
    ],
  },
];

export const mockConnections: Connection[] = [
  {
    id: "conn1",
    sourceSongId: "hip3",
    targetSongId: "el1",
    tags: ["electro influence", "similar bpm"],
  },
  {
    id: "conn2",
    sourceSongId: "el4",
    targetSongId: "hip4",
    tags: ["crossover", "innovative"],
  },
  {
    id: "conn3",
    sourceSongId: "tech2",
    targetSongId: "house3",
    tags: ["acid", "underground"],
  },
  {
    id: "conn4",
    sourceSongId: "house5",
    targetSongId: "urb2",
    tags: ["dance", "90s influence"],
  },
  {
    id: "conn5",
    sourceSongId: "hip5",
    targetSongId: "urb5",
    tags: ["political", "urban influence"],
  },
  // ... (add more connections)
];
