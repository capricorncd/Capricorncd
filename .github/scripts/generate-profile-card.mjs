import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const token = process.env.GITHUB_TOKEN;
const username = process.env.GITHUB_USERNAME;
const output =
  "profile-summary-card-output/solarized_dark/0-profile-details.svg";

if (!token || !username) {
  throw new Error("GITHUB_TOKEN and GITHUB_USERNAME are required");
}

const to = new Date();
const from = new Date(to);
from.setUTCFullYear(from.getUTCFullYear() - 1);
const split = new Date((from.getTime() + to.getTime()) / 2);
const firstHalfTo = new Date(split.getTime() - 1);

const profileQuery = `
  query ProfileCard($login: String!) {
    user(login: $login) {
      login
      name
      followers { totalCount }
      repositories(ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount }
    }
  }
`;

const contributionsQuery = `
  query Contributions($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks {
            contributionDays { date contributionCount }
          }
        }
      }
    }
  }
`;

async function graphql(query, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Capricorncd-profile-card",
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors) {
    const details = payload.errors?.map((error) => error.message).join("; ");
    throw new Error(details || `GitHub API returned ${response.status}`);
  }
  return payload.data;
}

const profile = await graphql(profileQuery, { login: username });
const user = profile.user;
if (!user) throw new Error(`GitHub user ${username} was not found`);

async function contributionDays(start, end) {
  const data = await graphql(contributionsQuery, {
    login: username,
    from: start.toISOString(),
    to: end.toISOString(),
  });
  return data.user.contributionsCollection.contributionCalendar.weeks.flatMap(
    (week) => week.contributionDays,
  );
}

// A full-year contribution query can exceed GitHub's GraphQL resource limit
// for active accounts, so fetch two bounded halves and merge them by date.
const daysByDate = new Map();
for (const day of [
  ...(await contributionDays(from, firstHalfTo)),
  ...(await contributionDays(split, to)),
]) {
  daysByDate.set(
    day.date,
    Math.max(daysByDate.get(day.date) ?? 0, day.contributionCount),
  );
}
const dailyTotals = [...daysByDate.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, count]) => count);
const totalContributions = dailyTotals.reduce((total, count) => total + count, 0);
const weeklyTotals = [];
for (let index = 0; index < dailyTotals.length; index += 7) {
  weeklyTotals.push(
    dailyTotals
      .slice(index, index + 7)
      .reduce((total, count) => total + count, 0),
  );
}
const width = 720;
const chartLeft = 32;
const chartRight = width - 32;
const chartTop = 154;
const chartBottom = 218;
const maxWeekly = Math.max(...weeklyTotals, 1);
const points = weeklyTotals
  .map((total, index) => {
    const x =
      chartLeft +
      (index * (chartRight - chartLeft)) / Math.max(weeklyTotals.length - 1, 1);
    const y = chartBottom - (total / maxWeekly) * (chartBottom - chartTop);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  })
  .join(" ");
const areaPoints = `${chartLeft},${chartBottom} ${points} ${chartRight},${chartBottom}`;

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const number = (value) => Number(value).toLocaleString("en-US");
const title = user.name ? `${user.login} (${user.name})` : user.login;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="250" viewBox="0 0 ${width} 250" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)} GitHub activity</title>
  <desc id="desc">${number(totalContributions)} contributions in the last year, ${number(user.repositories.totalCount)} public repositories, and ${number(user.followers.totalCount)} followers.</desc>
  <rect width="720" height="250" rx="8" fill="#073642"/>
  <g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">
    <text x="32" y="40" fill="#b58900" font-size="20" font-weight="600">${escapeXml(title)}</text>
    <text x="32" y="68" fill="#839496" font-size="13">GitHub activity · last 12 months</text>
    <g text-anchor="middle">
      <text x="120" y="108" fill="#fdf6e3" font-size="24" font-weight="600">${number(totalContributions)}</text>
      <text x="120" y="130" fill="#93a1a1" font-size="12">Contributions</text>
      <text x="360" y="108" fill="#fdf6e3" font-size="24" font-weight="600">${number(user.repositories.totalCount)}</text>
      <text x="360" y="130" fill="#93a1a1" font-size="12">Public repositories</text>
      <text x="600" y="108" fill="#fdf6e3" font-size="24" font-weight="600">${number(user.followers.totalCount)}</text>
      <text x="600" y="130" fill="#93a1a1" font-size="12">Followers</text>
    </g>
    <line x1="32" y1="218" x2="688" y2="218" stroke="#586e75" stroke-width="1"/>
    <polygon points="${areaPoints}" fill="#268bd2" opacity="0.18"/>
    <polyline points="${points}" fill="none" stroke="#2aa198" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="32" y="238" fill="#839496" font-size="11">Weekly contributions</text>
  </g>
</svg>
`;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, svg, "utf8");
console.log(`Wrote ${output}`);
