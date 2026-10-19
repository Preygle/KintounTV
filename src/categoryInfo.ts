// The Categories page guide: the catalog's categories (MyAnimeList genres and themes) in groups,
// each with a one-line explanation and a hand-picked title whose poster represents it.
// Covers were checked to belong to their category. A few names exist twice in the catalog
// (Comedy, Supernatural, Suspense under two ids); each is one category here, matching either id.

export interface CategoryInfo {
  name: string;
  ids: number[];
  blurb: string;
  cover: number | null; // post id; none for adult categories
  coverTitle: string | null;
}

export interface CategoryGroup {
  name: string;
  blurb: string;
  categories: CategoryInfo[];
}

export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    name: "Genres",
    blurb: "The main kind of story a title tells.",
    categories: [
      { name: "Action", ids: [1], blurb: "Fights, chases and high stakes, driven by physical conflict.", cover: 1000000457, coverTitle: "Attack on Titan" },
      { name: "Adventure", ids: [3], blurb: "Journeys into the unknown, quests and exploration.", cover: 1000003119, coverTitle: "Made in Abyss" },
      { name: "Avant Garde", ids: [19], blurb: "Experimental storytelling and unconventional visuals.", cover: 1000003735, coverTitle: "Neon Genesis Evangelion" },
      { name: "Award Winning", ids: [12], blurb: "Titles that won major anime or film awards.", cover: 1000004947, coverTitle: "Spirited Away" },
      { name: "Boys Love", ids: [16], blurb: "Romance between male characters.", cover: 1000001869, coverTitle: "given" },
      { name: "Comedy", ids: [5,560000], blurb: "Made first and foremost to make you laugh.", cover: 1000001816, coverTitle: "Gintama" },
      { name: "Drama", ids: [2], blurb: "Emotional, character-driven stories.", cover: 1000006239, coverTitle: "Your Lie in April" },
      { name: "Fantasy", ids: [4], blurb: "Magic, mythical creatures and invented worlds.", cover: 1000001663, coverTitle: "Frieren: Beyond Journey's End" },
      { name: "Girls Love", ids: [20], blurb: "Romance between female characters.", cover: 1000000695, coverTitle: "Bloom Into You" },
      { name: "Gourmet", ids: [8], blurb: "Food, cooking and the joy of eating.", cover: 1000001626, coverTitle: "Food Wars! The Third Plate" },
      { name: "Horror", ids: [21], blurb: "Fear, dread and the monstrous.", cover: 1000000339, coverTitle: "Another" },
      { name: "Mystery", ids: [7], blurb: "Puzzles, secrets and questions to solve.", cover: 1000001460, coverTitle: "Erased" },
      { name: "Romance", ids: [14], blurb: "Love stories and the people in them.", cover: 1000002598, coverTitle: "Kaguya-sama: Love is War" },
      { name: "Sci-Fi", ids: [6], blurb: "Science, technology and possible futures.", cover: 1000004980, coverTitle: "Steins;Gate" },
      { name: "Slice of Life", ids: [9], blurb: "Everyday moments, told with care.", cover: 1000000542, coverTitle: "Barakamon" },
      { name: "Sports", ids: [11], blurb: "Competition, training and the will to win.", cover: 1000002014, coverTitle: "Haikyu!!" },
      { name: "Supernatural", ids: [10,540000], blurb: "Ghosts, spirits and powers beyond nature.", cover: 1000003422, coverTitle: "Mob Psycho 100" },
      { name: "Suspense", ids: [18,550000], blurb: "Tension that keeps you on the edge of your seat.", cover: 1000001199, coverTitle: "Death Note" },
    ],
  },
  {
    name: "Worlds & settings",
    blurb: "Where and when the story takes place.",
    categories: [
      { name: "Historical", ids: [240000], blurb: "Set in the past, real or reimagined.", cover: 1000005999, coverTitle: "Vinland Saga" },
      { name: "Isekai", ids: [90000], blurb: "Transported to, or reborn in, another world.", cover: 1000004344, coverTitle: "Re:ZERO -Starting Life in Another World-" },
      { name: "Reincarnation", ids: [70000], blurb: "Starting over in a new life, memories intact.", cover: 1000003564, coverTitle: "Mushoku Tensei: Jobless Reincarnation" },
      { name: "Time Travel", ids: [150000], blurb: "Changing the past, or trapped in it.", cover: 1000005755, coverTitle: "Tokyo Revengers" },
      { name: "Mythology", ids: [40000], blurb: "Gods, legends and folklore.", cover: 1000003819, coverTitle: "Noragami" },
      { name: "Space", ids: [440000], blurb: "Stories among the stars.", cover: 1000001065, coverTitle: "Cowboy Bebop" },
      { name: "Urban Fantasy", ids: [270000], blurb: "The supernatural hiding in modern cities.", cover: 1000001572, coverTitle: "Fate/Zero" },
      { name: "Vampire", ids: [280000], blurb: "Bloodsuckers, hunters and long nights.", cover: 1000002159, coverTitle: "Hellsing Ultimate" },
      { name: "Samurai", ids: [260000], blurb: "Swords, honour and the way of the warrior.", cover: 1000004579, coverTitle: "Samurai Champloo" },
      { name: "Military", ids: [100000], blurb: "Soldiers, war and the chain of command.", cover: 1000001690, coverTitle: "Fullmetal Alchemist: Brotherhood" },
      { name: "Mecha", ids: [230000], blurb: "Giant robots and the pilots inside them.", cover: 1000001023, coverTitle: "Code Geass: Lelouch of the Rebellion" },
      { name: "Video Game", ids: [20000], blurb: "Stories inside or about video games.", cover: 1000005067, coverTitle: "Sword Art Online" },
      { name: "Villainess", ids: [220000], blurb: "Waking up as a story’s villain and dodging her doom.", cover: 1000003632, coverTitle: "My Next Life as a Villainess: All Routes Lead to Doom!" },
      { name: "Anthropomorphic", ids: [340000], blurb: "Animals with human traits and lives.", cover: 1000000569, coverTitle: "Beastars" },
    ],
  },
  {
    name: "Powers, danger & crime",
    blurb: "What the characters are up against.",
    categories: [
      { name: "Super Power", ids: [10000], blurb: "People with extraordinary abilities.", cover: 1000003592, coverTitle: "My Hero Academia" },
      { name: "Mahou Shoujo", ids: [410000], blurb: "Magical girls who transform to fight.", cover: 1000004256, coverTitle: "Puella Magi Madoka Magica" },
      { name: "Magical Sex Shift", ids: [510000], blurb: "Characters who change sex by magic or mishap.", cover: 1000004318, coverTitle: "Ranma ½ (2024)" },
      { name: "Survival", ids: [210000], blurb: "Staying alive against the odds.", cover: 1000005537, coverTitle: "The Promised Neverland" },
      { name: "Gore", ids: [420000], blurb: "Graphic, bloody violence.", cover: 1000000922, coverTitle: "Chainsaw Man" },
      { name: "Psychological", ids: [200000], blurb: "Mind games and what goes on inside people’s heads.", cover: 1000003497, coverTitle: "Monster" },
      { name: "Detective", ids: [400000], blurb: "Investigators cracking cases.", cover: 1000001230, coverTitle: "Detective Conan" },
      { name: "Organized Crime", ids: [250000], blurb: "Gangs, mafia and the criminal underworld.", cover: 1000000492, coverTitle: "Baccano!" },
      { name: "Delinquents", ids: [460000], blurb: "Rebels, punks and street fights.", cover: 1000001930, coverTitle: "Great Teacher Onizuka" },
      { name: "Martial Arts", ids: [390000], blurb: "Fighting styles, masters and training.", cover: 1000002704, coverTitle: "Kengan Ashura" },
      { name: "Strategy Game", ids: [430000], blurb: "Tactics, board games and battles of wits.", cover: 1000003788, coverTitle: "No Game No Life" },
      { name: "High Stakes Game", ids: [520000], blurb: "Gambles where losing can ruin you.", cover: 1000002620, coverTitle: "Kakegurui" },
    ],
  },
  {
    name: "Love & relationships",
    blurb: "How the romance plays out.",
    categories: [
      { name: "Harem", ids: [120000], blurb: "One lead and many love interests.", cover: 1000005540, coverTitle: "The Quintessential Quintuplets" },
      { name: "Reverse Harem", ids: [110000], blurb: "One heroine and many suitors.", cover: 1000003999, coverTitle: "Ouran High School Host Club" },
      { name: "Love Polygon", ids: [330000], blurb: "Love triangles and tangled feelings.", cover: 1000005778, coverTitle: "Toradora!" },
      { name: "Love Status Quo", ids: [450000], blurb: "Romance that never quite moves forward.", cover: 1000005168, coverTitle: "Teasing Master Takagi-san" },
      { name: "Romantic Subtext", ids: [370000], blurb: "Feelings left between the lines.", cover: 1000000114, coverTitle: "A Silent Voice" },
      { name: "Crossdressing", ids: [360000], blurb: "Characters dressing as another gender.", cover: 1000004204, coverTitle: "Princess Jellyfish" },
    ],
  },
  {
    name: "Everyday life",
    blurb: "Ordinary places, people and comfort.",
    categories: [
      { name: "School", ids: [60000], blurb: "Classrooms, clubs and school days.", cover: 1000000428, coverTitle: "Assassination Classroom" },
      { name: "Workplace", ids: [160000], blurb: "Jobs, offices and coworkers.", cover: 1000004781, coverTitle: "Shirobako" },
      { name: "Childcare", ids: [310000], blurb: "Raising and looking after children.", cover: 1000004954, coverTitle: "Spy x Family" },
      { name: "Iyashikei", ids: [470000], blurb: "Calm, healing stories to unwind with.", cover: 1000002907, coverTitle: "Laid-Back Camp" },
      { name: "CGDCT", ids: [350000], blurb: "Cute girls doing cute things.", cover: 1000002565, coverTitle: "K-ON!" },
      { name: "Pets", ids: [290000], blurb: "Animals and the people who love them.", cover: 1000000939, coverTitle: "Chi's Sweet Adventure" },
      { name: "Medical", ids: [480000], blurb: "Doctors, hospitals and medicine.", cover: 1000006235, coverTitle: "Young Black Jack" },
      { name: "Educational", ids: [530000], blurb: "Learn something while you watch.", cover: 1000000907, coverTitle: "Cells at Work!" },
      { name: "Otaku Culture", ids: [140000], blurb: "Fans, fandoms and life as an otaku.", cover: 1000006153, coverTitle: "Wotakoi: Love is Hard for Otaku" },
      { name: "Adult Cast", ids: [130000], blurb: "Grown-up characters with grown-up lives.", cover: 1000001928, coverTitle: "Great Pretender" },
      { name: "Gag Humor", ids: [380000], blurb: "Rapid-fire, absurd jokes.", cover: 1000003751, coverTitle: "Nichijou - My Ordinary Life" },
      { name: "Parody", ids: [30000], blurb: "Poking fun at other works and genres.", cover: 1000003931, coverTitle: "One-Punch Man" },
    ],
  },
  {
    name: "Sports & the arts",
    blurb: "Competing, performing and creating.",
    categories: [
      { name: "Combat Sports", ids: [50000], blurb: "Boxing, wrestling and fights in the ring.", cover: 1000002034, coverTitle: "Hajime no Ippo" },
      { name: "Team Sports", ids: [170000], blurb: "Teammates chasing a title together.", cover: 1000002869, coverTitle: "Kuroko's Basketball" },
      { name: "Racing", ids: [490000], blurb: "Cars, bikes and speed.", cover: 1000002442, coverTitle: "Initial D First Stage" },
      { name: "Music", ids: [190000], blurb: "Bands, instruments and the love of music.", cover: 1000000729, coverTitle: "Bocchi the Rock!" },
      { name: "Idols (Female)", ids: [180000], blurb: "Girl idol groups and the road to the stage.", cover: 1000003053, coverTitle: "Love Live! Sunshine!!" },
      { name: "Idols (Male)", ids: [500000], blurb: "Boy idol groups and the road to the stage.", cover: 1000005960, coverTitle: "Uta no☆Prince-sama♪ Maji Love 2000%" },
      { name: "Performing Arts", ids: [320000], blurb: "Theatre, dance and life on stage.", cover: 1000004418, coverTitle: "Revue Starlight" },
      { name: "Showbiz", ids: [80000], blurb: "Fame, acting and the entertainment industry.", cover: 1000000021, coverTitle: "[Oshi No Ko]" },
      { name: "Visual Arts", ids: [300000], blurb: "Painting, drawing and making art.", cover: 1000000717, coverTitle: "Blue Period" },
    ],
  },
  {
    name: "Adult (18+)",
    blurb: "Mature content; shown without artwork.",
    categories: [
      { name: "Ecchi", ids: [13], blurb: "Fan service and suggestive humour.", cover: null, coverTitle: null },
      { name: "Erotica", ids: [17], blurb: "Sexual themes for adult audiences.", cover: null, coverTitle: null },
      { name: "Hentai", ids: [15], blurb: "Explicit adult content.", cover: null, coverTitle: null },
    ],
  },
];
