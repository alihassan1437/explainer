// Narration usage: a monthly character cap so one key cannot run away.
// Stored as a JSON file under data/ (gitignored). On serverless hosts this
// does not persist between deploys; the cap is a backstop, not billing.

import fs from 'node:fs';
import path from 'node:path';

const monthOf = (now: number): string => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const monthlyCap = (): number => {
  const raw = process.env.NARRATION_MONTHLY_CHAR_CAP;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1_000_000;
};

interface UsageFile { [month: string]: { characters: number; narrations: number } }

function filePath(): string {
  return path.join(process.cwd(), 'data', 'narration-usage.json');
}

function readUsage(): UsageFile {
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf8')) as UsageFile;
  } catch {
    return {};
  }
}

export function usageThisMonth(now = Date.now()): { characters: number; cap: number } {
  const month = monthOf(now);
  const used = readUsage()[month]?.characters ?? 0;
  return { characters: used, cap: monthlyCap() };
}

/** Throws when the cap is reached. Call before synthesising. */
export function checkCap(characters: number, now = Date.now()): void {
  const { characters: used, cap } = usageThisMonth(now);
  if (used + characters > cap) {
    throw new Error(`This month's narration allowance is used up (${used.toLocaleString()} of ${cap.toLocaleString()} characters). It resets next month.`);
  }
}

/** Records a finished narration. Never throws. */
export function recordUsage(characters: number, now = Date.now()): void {
  try {
    const file = filePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const usage = readUsage();
    const month = monthOf(now);
    const cur = usage[month] ?? { characters: 0, narrations: 0 };
    usage[month] = { characters: cur.characters + characters, narrations: cur.narrations + 1 };
    fs.writeFileSync(file, JSON.stringify(usage));
  } catch {
    // Counting must never break narration.
  }
}
