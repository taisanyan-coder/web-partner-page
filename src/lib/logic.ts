export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';

export type Player = {
  id: number;
  name: string;
  rank: Rank;
  score: number;
};

export type Team = {
  members: Player[];
  sum: number;
};

export type RoundData = {
  round: number;
  teams: Team[];
  matchups: Array<[Team, Team]>;
  metrics: RoundMetrics;
  discordText: string;
};

export type RoundMetrics = {
  balancePenalty: number;
  diversityPenalty: number;
  leaderPenalty: number;
  hardPenalty: number;
  totalScore: number;
  maxSum: number;
  minSum: number;
  averageSum: number;
  variance: number;
};

export type Summary = {
  pairDuplicateTotal: number;
  maxPairCount: number;
  duplicateTeams: number;
  leaderCounts: Record<string, number>;
  maxLeaderCount: number;
  minLeaderCount: number;
  leaderWarning: boolean;
};

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

export type GenerateOptions = {
  candidateCount: number;
  swapIterations: number;
  balanceWeight: number;
  diversityWeight: number;
  leaderWeight: number;
  hardPenalty: number;
};

const rankScores: Record<Rank, number> = {
  S: 5,
  A: 4,
  B: 3,
  C: 2,
  D: 1,
};

const validRanks: Rank[] = ['S', 'A', 'B', 'C', 'D'];

export const defaultOptions: GenerateOptions = {
  candidateCount: 20,
  swapIterations: 200,
  balanceWeight: 1,
  diversityWeight: 1,
  leaderWeight: 1,
  hardPenalty: 10000,
};

export function parseInput(text: string): Player[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line, index) => {
    const parts = line.split(',');
    const name = parts[0]?.trim() ?? '';
    const rank = (parts[1]?.trim()?.toUpperCase() ?? '') as Rank;
    return {
      id: index,
      name,
      rank,
      score: rankScores[rank] ?? 0,
    };
  });
}

export function validatePlayers(players: Player[]): ValidationResult {
  const errors: string[] = [];
  if (players.length === 0) {
    errors.push('参加者を入力してください');
    return { ok: false, errors };
  }

  for (const player of players) {
    if (!player.name || !player.rank) {
      errors.push("1行は 'name, rank' の形式です");
      break;
    }
    if (!validRanks.includes(player.rank)) {
      errors.push('rankは S/A/B/C/D のいずれか');
      break;
    }
  }

  if (![8, 12, 16, 20].includes(players.length)) {
    errors.push('人数は 8/12/16/20 のいずれか（4の倍数）');
  }

  return { ok: errors.length === 0, errors };
}

export function filterNameCandidates(text: string): string[] {
  const allowed = /^[ぁ-ゖァ-ヺー・！〜。]{2,12}$/;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const unique = new Set<string>();
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, '');
    if (allowed.test(normalized)) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
}

export async function ocrToCandidates(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<string[]> {
  const { createWorker } = await import('tesseract.js');
  const image = await loadImageFromFile(file);
  const processed = preprocessImage(image);

  const worker = await createWorker({
    logger: (message) => {
      if (message.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(message.progress * 100));
      }
    },
  });

  await worker.loadLanguage('jpn+eng');
  await worker.initialize('jpn+eng');
  const result = await worker.recognize(processed);
  await worker.terminate();

  return filterNameCandidates(result.data.text ?? '');
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

function preprocessImage(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = image.width * scale;
  canvas.height = image.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const contrast = gray > 128 ? Math.min(gray + 30, 255) : Math.max(gray - 30, 0);
    imageData.data[i] = contrast;
    imageData.data[i + 1] = contrast;
    imageData.data[i + 2] = contrast;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function generateAllRounds(
  players: Player[],
  rounds: number,
  options: GenerateOptions,
): { roundsData: RoundData[]; summary: Summary } {
  const pairHistory = new Map<string, number>();
  const teamHistory = new Map<string, number>();
  const leaderHistory = new Map<number, number>();

  const roundsData: RoundData[] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const roundResult = generateRoundTeams(players, options, pairHistory, teamHistory, leaderHistory);
    const matchups = generateMatchups(roundResult.teams, Math.random);
    const discordText = formatRoundForDiscord({
      round,
      teams: roundResult.teams,
      matchups,
      metrics: roundResult.metrics,
      discordText: '',
    });

    roundsData.push({
      round,
      teams: roundResult.teams,
      matchups,
      metrics: roundResult.metrics,
      discordText,
    });

    updateHistories(roundResult.teams, pairHistory, teamHistory, leaderHistory);
  }

  const summary = buildSummary(players, pairHistory, teamHistory, leaderHistory);

  return { roundsData, summary };
}

export function generateRoundTeams(
  players: Player[],
  options: GenerateOptions,
  pairHistory: Map<string, number>,
  teamHistory: Map<string, number>,
  leaderHistory: Map<number, number>,
): { teams: Team[]; metrics: RoundMetrics } {
  let bestTeams: Team[] = [];
  let bestMetrics: RoundMetrics | null = null;

  for (let attempt = 0; attempt < options.candidateCount; attempt += 1) {
    const initial = greedyAssign(players, pairHistory);
    const improved = improveTeams(initial, options.swapIterations, pairHistory, teamHistory, leaderHistory, options);
    const ordered = optimizeLeadersWithinTeams(improved, leaderHistory, Math.random);
    const metrics = calculateMetrics(ordered, pairHistory, teamHistory, leaderHistory, options);

    if (!bestMetrics || metrics.totalScore < bestMetrics.totalScore) {
      bestTeams = ordered;
      bestMetrics = metrics;
    }
  }

  if (!bestMetrics) {
    const fallbackTeams = greedyAssign(players, pairHistory);
    const ordered = optimizeLeadersWithinTeams(fallbackTeams, leaderHistory, Math.random);
    bestMetrics = calculateMetrics(ordered, pairHistory, teamHistory, leaderHistory, options);
    bestTeams = ordered;
  }

  return { teams: bestTeams, metrics: bestMetrics };
}

export function optimizeLeadersWithinTeams(
  teams: Team[],
  leaderHistory: Map<number, number>,
  rng: () => number,
): Team[] {
  return teams.map((team) => {
    const sorted = [...team.members].sort((a, b) => {
      const countA = leaderHistory.get(a.id) ?? 0;
      const countB = leaderHistory.get(b.id) ?? 0;
      if (countA === countB) {
        return rng() - 0.5;
      }
      return countA - countB;
    });
    return {
      members: sorted,
      sum: team.sum,
    };
  });
}

export function generateMatchups(teams: Team[], rng: () => number): Array<[Team, Team]> {
  const shuffled = [...teams];
  shuffleInPlace(shuffled, rng);
  const pairs: Array<[Team, Team]> = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    pairs.push([shuffled[i], shuffled[i + 1]]);
  }
  return pairs;
}

export function formatRoundForDiscord(roundData: RoundData): string {
  const lines: string[] = [`[Round ${roundData.round}]`];
  const average = roundData.metrics.averageSum;
  roundData.teams.forEach((team, index) => {
    const members = team.members
      .map((member, idx) => `${idx === 0 ? '(L)' : ''}${member.name}(${member.rank})`)
      .join(' / ');
    const diff = team.sum - average;
    const diffText = diff === 0 ? '±0' : diff > 0 ? `+${diff}` : `${diff}`;
    lines.push(`Party ${index + 1} (sum=${team.sum}, diff=${diffText}): ${members}`);
  });
  lines.push('Matchups:');
  roundData.matchups.forEach((pair, index) => {
    lines.push(`- Party ${index * 2 + 1} vs Party ${index * 2 + 2}`);
  });
  return lines.join('\n');
}

function greedyAssign(players: Player[], pairHistory: Map<string, number>): Team[] {
  const teamCount = players.length / 4;
  const teams: Team[] = Array.from({ length: teamCount }, () => ({ members: [], sum: 0 }));
  const sorted = [...players].sort((a, b) => b.score - a.score);

  for (const player of sorted) {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    teams.forEach((team, index) => {
      if (team.members.length >= 4) {
        return;
      }
      const diversityIncrement = team.members.reduce((acc, member) => {
        const key = pairKey(member.id, player.id);
        const count = pairHistory.get(key) ?? 0;
        return acc + (count + 1) ** 2;
      }, 0);
      const score = team.sum + player.score + diversityIncrement;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    teams[bestIndex].members.push(player);
    teams[bestIndex].sum += player.score;
  }

  return teams;
}

function improveTeams(
  teams: Team[],
  iterations: number,
  pairHistory: Map<string, number>,
  teamHistory: Map<string, number>,
  leaderHistory: Map<number, number>,
  options: GenerateOptions,
): Team[] {
  let current = teams.map((team) => ({ members: [...team.members], sum: team.sum }));
  let currentMetrics = calculateMetrics(current, pairHistory, teamHistory, leaderHistory, options);

  for (let i = 0; i < iterations; i += 1) {
    const teamAIndex = Math.floor(Math.random() * current.length);
    let teamBIndex = Math.floor(Math.random() * current.length);
    while (teamBIndex === teamAIndex) {
      teamBIndex = Math.floor(Math.random() * current.length);
    }

    const teamA = current[teamAIndex];
    const teamB = current[teamBIndex];
    const memberAIndex = Math.floor(Math.random() * teamA.members.length);
    const memberBIndex = Math.floor(Math.random() * teamB.members.length);

    const next = current.map((team, idx) => {
      if (idx === teamAIndex || idx === teamBIndex) {
        return { members: [...team.members], sum: team.sum };
      }
      return team;
    });

    const memberA = next[teamAIndex].members[memberAIndex];
    const memberB = next[teamBIndex].members[memberBIndex];

    next[teamAIndex].members[memberAIndex] = memberB;
    next[teamBIndex].members[memberBIndex] = memberA;

    next[teamAIndex].sum = sumTeam(next[teamAIndex].members);
    next[teamBIndex].sum = sumTeam(next[teamBIndex].members);

    const metrics = calculateMetrics(next, pairHistory, teamHistory, leaderHistory, options);
    if (metrics.totalScore < currentMetrics.totalScore) {
      current = next;
      currentMetrics = metrics;
    }
  }

  return current;
}

function calculateMetrics(
  teams: Team[],
  pairHistory: Map<string, number>,
  teamHistory: Map<string, number>,
  leaderHistory: Map<number, number>,
  options: GenerateOptions,
): RoundMetrics {
  const sums = teams.map((team) => team.sum);
  const maxSum = Math.max(...sums);
  const minSum = Math.min(...sums);
  const averageSum = sums.reduce((acc, sum) => acc + sum, 0) / sums.length;
  const variance = sums.reduce((acc, sum) => acc + (sum - averageSum) ** 2, 0);
  const balancePenalty = (maxSum - minSum) * 10 + variance;

  const diversityPenalty = teams.reduce((acc, team) => {
    for (let i = 0; i < team.members.length; i += 1) {
      for (let j = i + 1; j < team.members.length; j += 1) {
        const key = pairKey(team.members[i].id, team.members[j].id);
        const count = pairHistory.get(key) ?? 0;
        acc += (count + 1) ** 2;
      }
    }
    return acc;
  }, 0);

  const leaderPenalty = teams.reduce((acc, team) => {
    const leader = team.members[0];
    if (!leader) {
      return acc;
    }
    const count = leaderHistory.get(leader.id) ?? 0;
    return acc + (count + 1) ** 2;
  }, 0);

  const hardPenalty = teams.reduce((acc, team) => {
    const key = teamKey(team.members);
    const count = teamHistory.get(key) ?? 0;
    if (count > 0) {
      return acc + options.hardPenalty;
    }
    return acc;
  }, 0);

  const totalScore =
    options.balanceWeight * balancePenalty +
    options.diversityWeight * diversityPenalty +
    options.leaderWeight * leaderPenalty +
    hardPenalty;

  return {
    balancePenalty,
    diversityPenalty,
    leaderPenalty,
    hardPenalty,
    totalScore,
    maxSum,
    minSum,
    averageSum,
    variance,
  };
}

function updateHistories(
  teams: Team[],
  pairHistory: Map<string, number>,
  teamHistory: Map<string, number>,
  leaderHistory: Map<number, number>,
): void {
  for (const team of teams) {
    for (let i = 0; i < team.members.length; i += 1) {
      for (let j = i + 1; j < team.members.length; j += 1) {
        const key = pairKey(team.members[i].id, team.members[j].id);
        pairHistory.set(key, (pairHistory.get(key) ?? 0) + 1);
      }
    }
    const teamKeyValue = teamKey(team.members);
    teamHistory.set(teamKeyValue, (teamHistory.get(teamKeyValue) ?? 0) + 1);

    const leader = team.members[0];
    if (leader) {
      leaderHistory.set(leader.id, (leaderHistory.get(leader.id) ?? 0) + 1);
    }
  }
}

function buildSummary(
  players: Player[],
  pairHistory: Map<string, number>,
  teamHistory: Map<string, number>,
  leaderHistory: Map<number, number>,
): Summary {
  let pairDuplicateTotal = 0;
  let maxPairCount = 0;
  pairHistory.forEach((count) => {
    if (count > 1) {
      pairDuplicateTotal += count - 1;
    }
    if (count > maxPairCount) {
      maxPairCount = count;
    }
  });

  let duplicateTeams = 0;
  teamHistory.forEach((count) => {
    if (count > 1) {
      duplicateTeams += 1;
    }
  });

  const leaderCounts: Record<string, number> = {};
  let maxLeaderCount = 0;
  let minLeaderCount = Number.POSITIVE_INFINITY;
  for (const player of players) {
    const count = leaderHistory.get(player.id) ?? 0;
    leaderCounts[player.name] = count;
    maxLeaderCount = Math.max(maxLeaderCount, count);
    minLeaderCount = Math.min(minLeaderCount, count);
  }
  if (minLeaderCount === Number.POSITIVE_INFINITY) {
    minLeaderCount = 0;
  }
  const leaderWarning = maxLeaderCount - minLeaderCount >= 2;

  return {
    pairDuplicateTotal,
    maxPairCount,
    duplicateTeams,
    leaderCounts,
    maxLeaderCount,
    minLeaderCount,
    leaderWarning,
  };
}

function sumTeam(members: Player[]): number {
  return members.reduce((acc, member) => acc + member.score, 0);
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function teamKey(members: Player[]): string {
  const ids = members.map((member) => member.id).sort((a, b) => a - b);
  return ids.join('-');
}

function shuffleInPlace<T>(array: T[], rng: () => number): void {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
