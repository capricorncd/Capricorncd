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

const query = `
  query ProfileCard($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      login
      name
      followers { totalCount }
      repositories(ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount }
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { contributionCount }
          }
        }
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "Capricorncd-profile-card",
  },
  body: JSON.stringify({
    query,
    variables: {
      login: username,
      from: from.toISOString(),
      to: to.toISOString(),
    },
  }),
});

const payload = await response.json();
if (!response.ok || payload.errors) {
  const details = payload.errors?.map((error) => error.message).join("; ");
  throw new Error(details || `GitHub API returned ${response.status}`);
}

const user = payload.data.user;
if (!user) throw new Error(`GitHub user ${username} was not found`);

const calendar = user.contributionsCollection.contributionCalendar;
const weeklyTotals = calendar.weeks.map((week) =>
  week.contributionDays.reduce(
    (total, day) => total + day.contributionCount,
    0,
  ),
);
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
  <desc id="desc">${number(calendar.totalContributions)} contributions in the last year, ${number(user.repositories.totalCount)} public repositories, and ${number(user.followers.totalCount)} followers.</desc>
  <rect width="720" height="250" rx="8" fill="#073642"/>
  <g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">
    <text x="32" y="40" fill="#b58900" font-size="20" font-weight="600">${escapeXml(title)}</text>
    <text x="32" y="68" fill="#839496" font-size="13">GitHub activity · last 12 months</text>
    <g text-anchor="middle">
      <text x="120" y="108" fill="#fdf6e3" font-size="24" font-weight="600">${number(calendar.totalContributions)}</text>
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
