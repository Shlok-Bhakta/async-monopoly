// Chance and Community Chest decks (classic US rules).

export type CardEffect =
  | { type: "moveTo"; space: number; collectOnPass?: boolean }
  | { type: "collect"; amount: number }
  | { type: "pay"; amount: number }
  | { type: "goToJail" }
  | { type: "jailFree" }
  | { type: "repairs"; perHouse: number; perHotel: number }
  | { type: "buildingWindfall"; perHouse: number; perHotel: number }
  | { type: "payEachPlayer"; amount: number }
  | { type: "collectFromEach"; amount: number }
  | { type: "nearestUtility" }
  | { type: "nearestRailroad" }
  | { type: "moveRelative"; spaces: number }
  | { type: "marketMove"; percent: number };

export interface Card {
  text: string;
  effect: CardEffect;
}

export const CHANCE_DECK: Card[] = [
  { text: "Advance to Go. Collect $200.", effect: { type: "moveTo", space: 0, collectOnPass: true } },
  { text: "Advance to Illinois Avenue.", effect: { type: "moveTo", space: 24 } },
  { text: "Advance to St. Charles Place.", effect: { type: "moveTo", space: 11 } },
  { text: "Advance to nearest Utility. If unowned, you may buy it from the Bank. If owned, throw dice and pay owner ten times the amount shown.", effect: { type: "nearestUtility" } },
  { text: "Advance to the nearest Railroad. If unowned, you may buy it from the Bank. If owned, pay owner twice the rental to which they are otherwise entitled.", effect: { type: "nearestRailroad" } },
  { text: "Bank pays you dividend of $50.", effect: { type: "collect", amount: 50 } },
  { text: "Go to Jail. Go directly to Jail. Do not pass GO, do not collect $200.", effect: { type: "goToJail" } },
  { text: "Go back three spaces.", effect: { type: "moveRelative", spaces: -3 } },
  { text: "Make general repairs on all your property: pay $25 for each house and $100 for each hotel.", effect: { type: "repairs", perHouse: 25, perHotel: 100 } },
  { text: "Speeding fine $15.", effect: { type: "pay", amount: 15 } },
  { text: "Take a trip to Reading Railroad. If you pass GO, collect $200.", effect: { type: "moveTo", space: 5, collectOnPass: true } },
  { text: "Advance to Boardwalk.", effect: { type: "moveTo", space: 39 } },
  { text: "You have been elected Chairman of the Board. Pay each player $50.", effect: { type: "payEachPlayer", amount: 50 } },
  { text: "Your building loan matures. Collect $150.", effect: { type: "collect", amount: 150 } },
  { text: "You have won a crossword competition. Collect $100.", effect: { type: "collect", amount: 100 } },
  { text: "The market surges! Every investment gains 25% of its principal.", effect: { type: "marketMove", percent: 25 } },
  { text: "Storm damage! Pay $30 for each house and $125 for each hotel.", effect: { type: "repairs", perHouse: 30, perHotel: 125 } },
  { text: "Your properties win city beautification awards. Collect $25 for each house and $100 for each hotel.", effect: { type: "buildingWindfall", perHouse: 25, perHotel: 100 } },
];

export const COMMUNITY_CHEST_DECK: Card[] = [
  { text: "Advance to Go. Collect $200.", effect: { type: "moveTo", space: 0, collectOnPass: true } },
  { text: "Bank error in your favor. Collect $200.", effect: { type: "collect", amount: 200 } },
  { text: "Doctor's fees. Pay $50.", effect: { type: "pay", amount: 50 } },
  { text: "From sale of stock you get $50.", effect: { type: "collect", amount: 50 } },
  { text: "Get Out of Jail Free. This card may be kept until needed or sold.", effect: { type: "jailFree" } },
  { text: "Go to Jail. Go directly to Jail. Do not pass GO, do not collect $200.", effect: { type: "goToJail" } },
  { text: "Grand Opera Night. Collect $50.", effect: { type: "collect", amount: 50 } },
  { text: "Holiday fund matures. Collect $100.", effect: { type: "collect", amount: 100 } },
  { text: "Income tax refund. Collect $20.", effect: { type: "collect", amount: 20 } },
  { text: "Life insurance matures. Collect $100.", effect: { type: "collect", amount: 100 } },
  { text: "Pay hospital fees of $100.", effect: { type: "pay", amount: 100 } },
  { text: "Pay school fees of $150.", effect: { type: "pay", amount: 150 } },
  { text: "Receive $25 consultancy fee.", effect: { type: "collect", amount: 25 } },
  { text: "You are assessed for street repairs: pay $40 for each house and $115 for each hotel.", effect: { type: "repairs", perHouse: 40, perHotel: 115 } },
  { text: "You have won second prize in a beauty contest. Collect $10.", effect: { type: "collect", amount: 10 } },
  { text: "The market slumps. Every investment loses 25% of its principal.", effect: { type: "marketMove", percent: -25 } },
  { text: "Local housing grants are approved. Collect $40 for each house and $150 for each hotel.", effect: { type: "buildingWindfall", perHouse: 40, perHotel: 150 } },
];
