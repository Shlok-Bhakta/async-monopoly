// Classic US Monopoly board data. Source of truth for the game.

export type SpaceType =
  | "go"
  | "property"
  | "railroad"
  | "utility"
  | "chance"
  | "communityChest"
  | "tax"
  | "jail"
  | "goToJail"
  | "freeParking"
  | "casino"
  | "stockMarket";

export interface Space {
  index: number;
  name: string;
  type: SpaceType;
  group?: string;
  price?: number;
  rents?: number[]; // [base, 1h, 2h, 3h, 4h, hotel]
  houseCost?: number;
  mortgage?: number;
  tax?: number;
}

export interface Group {
  id: string;
  color: string;
}

export const GROUPS: Record<string, Group> = {
  brown: { id: "brown", color: "#7a4b2a" },
  lightblue: { id: "lightblue", color: "#9fd8ef" },
  pink: { id: "pink", color: "#d06aa8" },
  orange: { id: "orange", color: "#f28c28" },
  red: { id: "red", color: "#e03c31" },
  yellow: { id: "yellow", color: "#f4e231" },
  green: { id: "green", color: "#2f9e44" },
  darkblue: { id: "darkblue", color: "#2563eb" },
};

export const SPACES: Space[] = [
  { index: 0, name: "GO", type: "go" },
  { index: 1, name: "Mediterranean Avenue", type: "property", group: "brown", price: 60, rents: [2, 10, 30, 90, 160, 250], houseCost: 50, mortgage: 30 },
  { index: 2, name: "Community Chest", type: "communityChest" },
  { index: 3, name: "Baltic Avenue", type: "property", group: "brown", price: 60, rents: [4, 20, 60, 180, 320, 450], houseCost: 50, mortgage: 30 },
  { index: 4, name: "Income Tax", type: "tax", tax: 200 },
  { index: 5, name: "Reading Railroad", type: "railroad", price: 200, mortgage: 100 },
  { index: 6, name: "Oriental Avenue", type: "property", group: "lightblue", price: 100, rents: [6, 30, 90, 270, 400, 550], houseCost: 50, mortgage: 50 },
  { index: 7, name: "Chance", type: "chance" },
  { index: 8, name: "Vermont Avenue", type: "property", group: "lightblue", price: 100, rents: [6, 30, 90, 270, 400, 550], houseCost: 50, mortgage: 50 },
  { index: 9, name: "Connecticut Avenue", type: "property", group: "lightblue", price: 120, rents: [8, 40, 100, 300, 450, 600], houseCost: 50, mortgage: 60 },
  { index: 10, name: "Jail / Just Visiting", type: "jail" },
  { index: 11, name: "St. Charles Place", type: "property", group: "pink", price: 140, rents: [10, 50, 150, 450, 625, 750], houseCost: 100, mortgage: 70 },
  { index: 12, name: "Electric Company", type: "utility", price: 150, mortgage: 75 },
  { index: 13, name: "States Avenue", type: "property", group: "pink", price: 140, rents: [10, 50, 150, 450, 625, 750], houseCost: 100, mortgage: 70 },
  { index: 14, name: "Virginia Avenue", type: "property", group: "pink", price: 160, rents: [12, 60, 180, 500, 700, 900], houseCost: 100, mortgage: 80 },
  { index: 15, name: "Pennsylvania Railroad", type: "railroad", price: 200, mortgage: 100 },
  { index: 16, name: "St. James Place", type: "property", group: "orange", price: 180, rents: [14, 70, 200, 550, 750, 950], houseCost: 100, mortgage: 90 },
  { index: 17, name: "Community Chest", type: "communityChest" },
  { index: 18, name: "Tennessee Avenue", type: "property", group: "orange", price: 180, rents: [14, 70, 200, 550, 750, 950], houseCost: 100, mortgage: 90 },
  { index: 19, name: "New York Avenue", type: "property", group: "orange", price: 200, rents: [16, 80, 220, 600, 800, 1000], houseCost: 100, mortgage: 100 },
  { index: 20, name: "Casino", type: "casino" },
  { index: 21, name: "Kentucky Avenue", type: "property", group: "red", price: 220, rents: [18, 90, 250, 700, 875, 1050], houseCost: 150, mortgage: 110 },
  { index: 22, name: "Chance", type: "chance" },
  { index: 23, name: "Indiana Avenue", type: "property", group: "red", price: 220, rents: [18, 90, 250, 700, 875, 1050], houseCost: 150, mortgage: 110 },
  { index: 24, name: "Illinois Avenue", type: "property", group: "red", price: 240, rents: [20, 100, 300, 750, 925, 1100], houseCost: 150, mortgage: 120 },
  { index: 25, name: "B&O Railroad", type: "railroad", price: 200, mortgage: 100 },
  { index: 26, name: "Atlantic Avenue", type: "property", group: "yellow", price: 260, rents: [22, 110, 330, 800, 975, 1150], houseCost: 150, mortgage: 130 },
  { index: 27, name: "Ventnor Avenue", type: "property", group: "yellow", price: 260, rents: [22, 110, 330, 800, 975, 1150], houseCost: 150, mortgage: 130 },
  { index: 28, name: "Water Works", type: "utility", price: 150, mortgage: 75 },
  { index: 29, name: "Marvin Gardens", type: "property", group: "yellow", price: 280, rents: [24, 120, 360, 850, 1025, 1200], houseCost: 150, mortgage: 140 },
  { index: 30, name: "Go To Jail", type: "goToJail" },
  { index: 31, name: "Pacific Avenue", type: "property", group: "green", price: 300, rents: [26, 130, 390, 900, 1100, 1275], houseCost: 200, mortgage: 150 },
  { index: 32, name: "North Carolina Avenue", type: "property", group: "green", price: 300, rents: [26, 130, 390, 900, 1100, 1275], houseCost: 200, mortgage: 150 },
  { index: 33, name: "Community Chest", type: "communityChest" },
  { index: 34, name: "Pennsylvania Avenue", type: "property", group: "green", price: 320, rents: [28, 150, 450, 1000, 1200, 1400], houseCost: 200, mortgage: 160 },
  { index: 35, name: "Short Line Railroad", type: "railroad", price: 200, mortgage: 100 },
  { index: 36, name: "Chance", type: "chance" },
  { index: 37, name: "Park Place", type: "property", group: "darkblue", price: 350, rents: [35, 175, 500, 1100, 1300, 1500], houseCost: 200, mortgage: 175 },
  { index: 38, name: "Stock Market", type: "stockMarket" },
  { index: 39, name: "Boardwalk", type: "property", group: "darkblue", price: 400, rents: [50, 200, 600, 1400, 1700, 2000], houseCost: 200, mortgage: 200 },
];

// Railroads: rent based on number owned: [1,2,3,4] -> [25,50,100,200]
export const RAILROAD_RENTS = [25, 50, 100, 200];
// Utilities: dice multipliers for [1, 2] utilities owned
export const UTILITY_MULTIPLIERS = [4, 10];

export const HOUSE_SUPPLY = 32;
export const HOTEL_SUPPLY = 12;
export const STARTING_MONEY = 1500;
export const GO_SALARY = 200;
export const JAIL_BAIL = 50;
export const MAX_JAIL_TURNS = 3;

export function getSpace(index: number): Space {
  return SPACES[((index % 40) + 40) % 40];
}

export function isOnPropertySet(position: number, targetSpace: number): boolean {
  const landed = getSpace(position);
  const target = getSpace(targetSpace);
  return landed.type === "property" && target.type === "property" && landed.group === target.group;
}

export function groupSpaces(groupId: string): Space[] {
  return SPACES.filter((s) => s.group === groupId);
}

export function isGroupMonopolized(owned: number[], groupId: string): boolean {
  const needed = groupSpaces(groupId).map((s) => s.index);
  return needed.every((i) => owned.includes(i));
}

export function railroadCount(owned: number[]): number {
  return owned.filter((i) => SPACES[i].type === "railroad").length;
}

export function utilityCount(owned: number[]): number {
  return owned.filter((i) => SPACES[i].type === "utility").length;
}

export function findNearestRailroad(position: number): number {
  const rail = [5, 15, 25, 35];
  let best = rail[0];
  let bestDist = 40;
  for (const r of rail) {
    const dist = ((r - position) % 40 + 40) % 40;
    if (dist > 0 && dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  return best;
}

export function findNearestUtility(position: number): number {
  const utils = [12, 28];
  let best = utils[0];
  let bestDist = 40;
  for (const u of utils) {
    const dist = ((u - position) % 40 + 40) % 40;
    if (dist > 0 && dist < bestDist) {
      bestDist = dist;
      best = u;
    }
  }
  return best;
}
