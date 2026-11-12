import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERNAME = process.env.GITHUB_USERNAME || 'ktirumalaachari';
const TOKEN = process.env.GITHUB_TOKEN || '';
const headers = {
  'User-Agent': 'GitHub-Stats-Updater',
  ...(TOKEN ? { Authorization: `token ${TOKEN}` } : {})
};

const LANG_COLORS = {
  TypeScript: '#3178C6',
  JavaScript: '#F1E05A',
  'Jupyter Notebook': '#DA5B0B',
  HTML: '#EF4444',
  CSS: '#818CF8',
  Python: '#4F8EF7',
  'C++': '#F34B7D',
  Java: '#B07219',
  Go: '#00ADD8',
  Rust: '#DEA584'
};

async function fetchJSON(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

function getColDigits(colClass, keyframe, targetNumber, xPos, digitHeight = 100.8) {
  const numStr = String(targetNumber);
  const targetDigit = parseInt(numStr, 10);
  const targetIndex = 10 + targetDigit; // index in 0-9 repeat
  const translateY = -(targetIndex * digitHeight).toFixed(1);

  let texts = '';
  for (let cycle = 0; cycle < 2; cycle++) {
    for (let d = 0; d < 10; d++) {
      const idx = cycle * 10 + d;
      const y = (218.0 + idx * digitHeight).toFixed(1);
      texts += `<text x="${xPos}" y="${y}" text-anchor="middle" font-size="72" font-weight="800" fill="url(#numfill)">${d}</text>\n`;
    }
  }

  return {
    keyframe: `@keyframes ${keyframe}{0%,3.571%{transform:translateY(0px);animation-timing-function:cubic-bezier(.2,.8,.2,1)}15.714%,100%{transform:translateY(${translateY}px)}}`,
    svgGroup: `<g style="animation:${keyframe} 14.0s infinite;transform:translateY(${translateY}px)">\n${texts}</g>`
  };
}

async function main() {
  console.log(`Fetching stats for: ${USERNAME}...`);

  // 1. Fetch Streak Stats
  let totalContrib = 32;
  let totalRange = 'Jan 21, 2023 to present';
  let currStreak = 0;
  let longestStreak = 4;
  let longestRange = 'Sep 27 to Sep 30';

  try {
    const streakSvg = await fetchText(`https://streak-stats.demolab.com/?user=${USERNAME}`);
    
    const mTotal = streakSvg.match(/Total Contributions big number[\s\S]*?<text[^>]*>\s*([0-9,]+)\s*<\/text>/);
    if (mTotal) totalContrib = parseInt(mTotal[1].replace(/,/g, ''), 10);

    const mTotalRange = streakSvg.match(/Total Contributions range[\s\S]*?<text[^>]*>\s*([^\n<]+)\s*<\/text>/);
    if (mTotalRange) totalRange = mTotalRange[1].trim().replace(' - ', ' to ').toLowerCase().replace('present', 'present');

    const mCurr = streakSvg.match(/Current Streak big number[\s\S]*?<text[^>]*>\s*([0-9,]+)\s*<\/text>/);
    if (mCurr) currStreak = parseInt(mCurr[1].replace(/,/g, ''), 10);

    const mLongest = streakSvg.match(/Longest Streak big number[\s\S]*?<text[^>]*>\s*([0-9,]+)\s*<\/text>/);
    if (mLongest) longestStreak = parseInt(mLongest[1].replace(/,/g, ''), 10);

    const mLongestRange = streakSvg.match(/Longest Streak range[\s\S]*?<text[^>]*>\s*([^\n<]+)\s*<\/text>/);
    if (mLongestRange) longestRange = mLongestRange[1].trim().replace(' - ', ' to ');
  } catch (err) {
    console.warn('Could not fetch from streak-stats API, using cached values:', err.message);
  }

  // 2. Fetch Repositories and Languages
  const repoLanguages = {};
  const byteLanguages = {};
  const hourlyCommits = new Array(24).fill(0);

  try {
    const repos = await fetchJSON(`https://api.github.com/users/${USERNAME}/repos?per_page=100`);
    
    for (const repo of repos) {
      if (repo.fork) continue;
      if (repo.language) {
        repoLanguages[repo.language] = (repoLanguages[repo.language] || 0) + 1;
      }

      // Fetch repo languages
      try {
        const langs = await fetchJSON(repo.languages_url);
        for (const [lang, bytes] of Object.entries(langs)) {
          byteLanguages[lang] = (byteLanguages[lang] || 0) + bytes;
        }
      } catch (e) {}

      // Fetch commits for hourly distribution
      try {
        const commits = await fetchJSON(`https://api.github.com/repos/${USERNAME}/${repo.name}/commits?per_page=100`);
        for (const c of commits) {
          if (!c.commit?.author?.date) continue;
          const dt = new Date(c.commit.author.date);
          // Convert to UTC+5:30
          const utcMins = dt.getUTCHours() * 60 + dt.getUTCMinutes() + 330;
          const hour = Math.floor((utcMins % 1440) / 60);
          hourlyCommits[hour]++;
        }
      } catch (e) {}
    }
  } catch (err) {
    console.warn('Could not fetch GitHub repos API:', err.message);
  }

  // Normalize Top Languages by Repo
  const totalRepos = Object.values(repoLanguages).reduce((a, b) => a + b, 0) || 1;
  const sortedRepoLangs = Object.entries(repoLanguages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([lang, count]) => ({
      name: lang,
      color: LANG_COLORS[lang] || '#818CF8',
      percent: Math.round((count / totalRepos) * 100)
    }));

  // Normalize Top Languages by Commit / Bytes
  const totalBytes = Object.values(byteLanguages).reduce((a, b) => a + b, 0) || 1;
  const sortedByteLangs = Object.entries(byteLanguages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang, bytes]) => ({
      name: lang,
      color: LANG_COLORS[lang] || '#818CF8',
      percent: Math.round((bytes / totalBytes) * 100)
    }));

  // Fallbacks if empty
  if (sortedRepoLangs.length === 0) {
    sortedRepoLangs.push({ name: 'TypeScript', color: '#3178C6', percent: 50 }, { name: 'JavaScript', color: '#F1E05A', percent: 33 }, { name: 'Jupyter Notebook', color: '#DA5B0B', percent: 17 });
  }
  if (sortedByteLangs.length === 0) {
    sortedByteLangs.push({ name: 'TypeScript', color: '#3178C6', percent: 60 }, { name: 'JavaScript', color: '#F1E05A', percent: 18 }, { name: 'Jupyter Notebook', color: '#DA5B0B', percent: 16 }, { name: 'HTML', color: '#EF4444', percent: 3 }, { name: 'CSS', color: '#818CF8', percent: 3 });
  }

  // Calculate Rolling digits for Total Contributions
  const totStr = String(totalContrib).padStart(2, '0');
  const d1 = getColDigits('c1', 'k1', totStr[0], '98.0');
  const d2 = getColDigits('c2', 'k2', totStr[1], '143.0');

  // Longest streak single digit roll
  const longStr = String(longestStreak);
  const dLong = getColDigits('cLong', 'k8', longStr[longStr.length - 1], '918.0');

  // Commits by hour calculation
  const maxCommits = Math.max(...hourlyCommits, 1);
  const peakHour = hourlyCommits.indexOf(maxCommits);

  const barXStarts = [112.4, 155.2, 198.1, 240.9, 283.8, 326.6, 369.4, 412.3, 455.1, 497.9, 540.8, 583.6, 626.4, 669.2, 712.1, 754.9, 797.8, 840.6, 883.4, 926.2, 969.1, 1011.9, 1054.8, 1097.6];
  let barsSvg = '';
  barXStarts.forEach((x, h) => {
    const count = hourlyCommits[h];
    const height = Math.max(2.0, (count / maxCommits) * 80.0);
    const y = 472.0 - height;
    const isPeak = h === peakHour && count > 0;
    const kf = `k${11 + h}`;
    barsSvg += `<rect class="b" x="${x}" y="${y.toFixed(1)}" width="26" height="${height.toFixed(1)}" rx="${height > 6 ? 4 : 2}" fill="${isPeak ? 'url(#barPeak)' : 'url(#bar)'}" style="animation:${kf} 14.0s infinite"/>\n`;
  });

  const peakBoxX = Math.max(40, barXStarts[peakHour] - 50);

  // Top Languages by Repo Donut
  const CIRC = 427.26;
  let offsetR = -1.5;
  let donutRepoSvg = '';
  let kfRepo = '';
  sortedRepoLangs.forEach((l, i) => {
    const len = (l.percent / 100) * CIRC;
    const kf = `k${35 + i}`;
    donutRepoSvg += `<circle cx="450" cy="668" r="68" fill="none" stroke="${l.color}" stroke-width="26" stroke-dasharray="${len.toFixed(2)} ${CIRC}" stroke-dashoffset="${offsetR.toFixed(2)}" transform="rotate(-90 450 668)" style="animation:${kf} 14.0s infinite"/>\n`;
    kfRepo += `@keyframes ${kf}{0%,${17 + i * 2}%{stroke-dasharray:0 ${CIRC};animation-timing-function:linear}${21 + i * 2}%,100%{stroke-dasharray:${len.toFixed(2)} ${CIRC}}}\n`;
    offsetR -= len;
  });

  // Top Languages by Commit Donut
  let offsetC = -1.5;
  let donutCommitSvg = '';
  let kfCommit = '';
  sortedByteLangs.forEach((l, i) => {
    const len = (l.percent / 100) * CIRC;
    const kf = `k${41 + i}`;
    donutCommitSvg += `<circle cx="1020" cy="668" r="68" fill="none" stroke="${l.color}" stroke-width="26" stroke-dasharray="${len.toFixed(2)} ${CIRC}" stroke-dashoffset="${offsetC.toFixed(2)}" transform="rotate(-90 1020 668)" style="animation:${kf} 14.0s infinite"/>\n`;
    kfCommit += `@keyframes ${kf}{0%,${19 + i * 2}%{stroke-dasharray:0 ${CIRC};animation-timing-function:linear}${24 + i * 2}%,100%{stroke-dasharray:${len.toFixed(2)} ${CIRC}}}\n`;
    offsetC -= len;
  });

  // Generate complete SVG
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800" role="img" aria-labelledby="t d">
<title id="t">GitHub stats for ${USERNAME}</title>
<desc id="d">Total contributions, current and longest streak, commits by hour, and top languages by repository and by commit.</desc>
<style>
text{font-family:'Segoe UI Variable Display','Segoe UI','SF Pro Display',Inter,system-ui,-apple-system,Roboto,'Helvetica Neue',Arial,sans-serif;font-variant-numeric:tabular-nums}
.b{transform-box:fill-box;transform-origin:50% 100%}
#content{animation:master 14.0s infinite}
@keyframes master{0%{opacity:0}3%{opacity:1}93%{opacity:1}97%{opacity:0}100%{opacity:0}}
${d1.keyframe}
${d2.keyframe}
@keyframes k4{0%,4.643%{stroke-dashoffset:389.56;animation-timing-function:cubic-bezier(.2,.8,.2,1)}16.786%,100%{stroke-dashoffset:389.56}}
@keyframes k5{0%,17.143%{opacity:0;animation-timing-function:ease}20.0%,100%{opacity:0}}
@keyframes k6{0%,4.643%{transform:translateY(0px);animation-timing-function:cubic-bezier(.2,.8,.2,1)}16.786%,100%{transform:translateY(-644.0px)}}
${dLong.keyframe}
@keyframes k10{0%,18.571%{opacity:0;animation-timing-function:ease}22.857%,100%{opacity:1}}
${Array.from({ length: 24 }, (_, i) => `@keyframes k${11 + i}{0%,${(10.7 + i * 0.28).toFixed(1)}%{transform:scaleY(0);animation-timing-function:cubic-bezier(.2,.8,.2,1)}${(15.7 + i * 0.28).toFixed(1)}%,100%{transform:scaleY(1)}}`).join('\n')}
${kfRepo}
@keyframes k40{0%,27.143%{opacity:0;animation-timing-function:ease}30.714%,100%{opacity:1}}
${kfCommit}
@keyframes k46{0%,29.286%{opacity:0;animation-timing-function:ease}32.857%,100%{opacity:1}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.dot{display:none}}
</style>

<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0A0F1F"/><stop offset="1" stop-color="#0F1530"/>
  </linearGradient>
  <radialGradient id="glowA" cx="0.12" cy="0.05" r="0.55">
    <stop offset="0" stop-color="#7C5CFF" stop-opacity="0.28"/><stop offset="1" stop-color="#7C5CFF" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="glowB" cx="0.92" cy="0.98" r="0.5">
    <stop offset="0" stop-color="#22D3EE" stop-opacity="0.2"/><stop offset="1" stop-color="#22D3EE" stop-opacity="0"/>
  </radialGradient>
  <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
    <circle cx="2" cy="2" r="1" fill="#FFFFFF" fill-opacity="0.055"/>
  </pattern>
  <linearGradient id="numfill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C9D2F5"/>
  </linearGradient>
  <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#5EEAD4"/><stop offset="0.55" stop-color="#818CF8"/><stop offset="1" stop-color="#C084FC"/>
  </linearGradient>
  <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#8B9BFF"/><stop offset="1" stop-color="#4338CA" stop-opacity="0.75"/>
  </linearGradient>
  <linearGradient id="barPeak" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#7CF3E0"/><stop offset="1" stop-color="#6366F1"/>
  </linearGradient>
  <linearGradient id="tileEdge" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#5EEAD4" stop-opacity="0.55"/><stop offset="0.5" stop-color="#818CF8" stop-opacity="0.35"/><stop offset="1" stop-color="#C084FC" stop-opacity="0.55"/>
  </linearGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="5" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <clipPath id="frame"><rect width="1200" height="800" rx="28"/></clipPath>
</defs>

<g clip-path="url(#frame)">
  <rect width="1200" height="800" fill="url(#bg)"/>
  <rect width="1200" height="800" fill="url(#dots)"/>
  <rect width="1200" height="800" fill="url(#glowA)"/>
  <rect width="1200" height="800" fill="url(#glowB)"/>
</g>
<rect x="0.5" y="0.5" width="1199" height="799" rx="28" fill="none" stroke="#FFFFFF" stroke-opacity="0.08"/>

<g id="content">
<text x="40" y="54" font-size="27" font-weight="800" fill="#E8ECF8" letter-spacing="-0.4">GitHub stats</text>
<text x="40" y="78" font-size="14" fill="#8B94B3">${USERNAME} &#183; Full Stack Developer</text>

<!-- Total Contributions -->
<rect x="40" y="96" width="300" height="190" rx="20" fill="#FFFFFF" fill-opacity="0.04" stroke="#FFFFFF" stroke-opacity="0.09" stroke-width="1"/>
<text x="68" y="138" font-size="15" font-weight="600" fill="#8B94B3">Total contributions</text>
<clipPath id="c1_3_218_68"><rect x="64.0" y="156.1" width="120.0" height="80.6"/></clipPath>
<g clip-path="url(#c1_3_218_68)">
${d1.svgGroup}
${d2.svgGroup}
</g>
<text x="68" y="260" font-size="13" font-weight="600" fill="#5EEAD4">${totalRange}</text>

<!-- Current Streak -->
<rect x="360" y="96" width="480" height="190" rx="20" fill="#FFFFFF" fill-opacity="0.04" stroke="url(#tileEdge)" stroke-opacity="1" stroke-width="1.4"/>
<circle cx="472" cy="191" r="62" fill="none" stroke="#FFFFFF" stroke-opacity="0.1" stroke-width="10"/>
<circle cx="472" cy="191" r="62" fill="none" stroke="url(#ring)" stroke-width="10" stroke-linecap="round" stroke-dasharray="389.56" stroke-dashoffset="389.56" transform="rotate(-90 472 191)" filter="url(#glow)" style="animation:k4 14.0s infinite"/>
<clipPath id="c6_2_207_443"><rect x="442.0" y="167.4" width="60.0" height="51.5"/></clipPath>
<g clip-path="url(#c6_2_207_443)">
<g style="animation:k6 14.0s infinite;transform:translateY(-644.0px)">
<text x="472.0" y="207.0" text-anchor="middle" font-size="46" font-weight="800" fill="url(#numfill)">0</text>
<text x="472.0" y="271.4" text-anchor="middle" font-size="46" font-weight="800" fill="url(#numfill)">1</text>
<text x="472.0" y="335.8" text-anchor="middle" font-size="46" font-weight="800" fill="url(#numfill)">2</text>
<text x="472.0" y="400.2" text-anchor="middle" font-size="46" font-weight="800" fill="url(#numfill)">3</text>
<text x="472.0" y="464.6" text-anchor="middle" font-size="46" font-weight="800" fill="url(#numfill)">4</text>
<text x="472.0" y="529.0" text-anchor="middle" font-size="46" font-weight="800" fill="url(#numfill)">5</text>
<text x="472.0" y="593.4" text-anchor="middle" font-size="46" font-weight="800" fill="url(#numfill)">6</text>
<text x="472.0" y="657.8" text-anchor="middle" font-size="46" font-weight="800" fill="url(#numfill)">7</text>
<text x="472.0" y="722.2" text-anchor="middle" font-size="46" font-weight="800" fill="url(#numfill)">8</text>
<text x="472.0" y="786.6" text-anchor="middle" font-size="46" font-weight="800" fill="url(#numfill)">9</text>
<text x="472.0" y="851.0" text-anchor="middle" font-size="46" font-weight="800" fill="url(#numfill)">0</text>
</g>
</g>
<text x="472" y="229" text-anchor="middle" font-size="12" font-weight="600" fill="#8B94B3">days</text>
<text x="574" y="174" font-size="19" font-weight="700" fill="#E8ECF8">Current streak</text>
<text x="574" y="200" font-size="14" fill="#5EEAD4" font-weight="600">${currStreak} days</text>
<text x="574" y="228" font-size="13" fill="#8B94B3">Longest streak: ${longestStreak} days</text>

<!-- Longest Streak -->
<rect x="860" y="96" width="300" height="190" rx="20" fill="#FFFFFF" fill-opacity="0.04" stroke="#FFFFFF" stroke-opacity="0.09" stroke-width="1"/>
<text x="888" y="138" font-size="15" font-weight="600" fill="#8B94B3">Longest streak</text>
<clipPath id="c8_2_218_888"><rect x="884.0" y="156.1" width="70.0" height="80.6"/></clipPath>
<g clip-path="url(#c8_2_218_888)">
${dLong.svgGroup}
</g>
<text x="965" y="218" font-size="20" font-weight="600" fill="#8B94B3">days</text>
<text x="888" y="260" font-size="13" font-weight="600" fill="#5EEAD4">${longestRange}</text>

<!-- Commits by hour -->
<rect x="40" y="306" width="1120" height="200" rx="20" fill="#FFFFFF" fill-opacity="0.04" stroke="#FFFFFF" stroke-opacity="0.09" stroke-width="1"/>
<text x="68" y="344" font-size="17" font-weight="700" fill="#E8ECF8">Commits by hour</text>
<text x="1132" y="344" text-anchor="end" font-size="13" fill="#8B94B3">UTC+5:30</text>
<line x1="100" y1="472.0" x2="1132" y2="472.0" stroke="#FFFFFF" stroke-opacity="0.16"/>
<text x="90" y="476.0" text-anchor="end" font-size="11" fill="#8B94B3">0</text>
<line x1="100" y1="432.0" x2="1132" y2="432.0" stroke="#FFFFFF" stroke-opacity="0.06"/>
<text x="90" y="436.0" text-anchor="end" font-size="11" fill="#8B94B3">5</text>
<line x1="100" y1="392.0" x2="1132" y2="392.0" stroke="#FFFFFF" stroke-opacity="0.06"/>
<text x="90" y="396.0" text-anchor="end" font-size="11" fill="#8B94B3">10</text>

<!-- Peak hours indicator -->
<g style="animation:k10 14.0s infinite">
  <rect x="${peakBoxX.toFixed(1)}" y="358" width="126.0" height="118.0" rx="10" fill="#5EEAD4" fill-opacity="0.08"/>
  <text x="${(peakBoxX + 63).toFixed(1)}" y="374" text-anchor="middle" font-size="12" font-weight="600" fill="#5EEAD4">Peak hours</text>
</g>

<!-- 24 Hour Bars -->
${barsSvg}
<text x="125.4" y="492" text-anchor="middle" font-size="11" fill="#8B94B3">00</text>
<text x="253.9" y="492" text-anchor="middle" font-size="11" fill="#8B94B3">03</text>
<text x="382.4" y="492" text-anchor="middle" font-size="11" fill="#8B94B3">06</text>
<text x="510.9" y="492" text-anchor="middle" font-size="11" fill="#8B94B3">09</text>
<text x="639.4" y="492" text-anchor="middle" font-size="11" fill="#8B94B3">12</text>
<text x="767.9" y="492" text-anchor="middle" font-size="11" fill="#8B94B3">15</text>
<text x="896.4" y="492" text-anchor="middle" font-size="11" fill="#8B94B3">18</text>
<text x="1024.9" y="492" text-anchor="middle" font-size="11" fill="#8B94B3">21</text>
<text x="1110.6" y="492" text-anchor="middle" font-size="11" fill="#8B94B3">23</text>

<!-- Top Languages by Repository -->
<rect x="40" y="526" width="550" height="250" rx="20" fill="#FFFFFF" fill-opacity="0.04" stroke="#FFFFFF" stroke-opacity="0.09" stroke-width="1"/>
<text x="68" y="566" font-size="17" font-weight="700" fill="#E8ECF8">Top languages by repository</text>
${sortedRepoLangs.map((l, i) => `
<circle cx="74" cy="${620 + i * 35}" r="5" fill="${l.color}"/>
<text x="92" y="${625 + i * 35}" font-size="14" fill="#E8ECF8">${l.name}</text>
<text x="302" y="${625 + i * 35}" text-anchor="end" font-size="14" font-weight="600" fill="#8B94B3">${l.percent}%</text>
`).join('')}
<circle cx="450" cy="668" r="68" fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="26"/>
${donutRepoSvg}
<g style="animation:k40 14.0s infinite">
  <text x="450" y="672" text-anchor="middle" font-size="24" font-weight="800" fill="url(#numfill)">${sortedRepoLangs[0].percent}%</text>
  <text x="450" y="690" text-anchor="middle" font-size="12" fill="#8B94B3">${sortedRepoLangs[0].name}</text>
</g>

<!-- Top Languages by Commit -->
<rect x="610" y="526" width="550" height="250" rx="20" fill="#FFFFFF" fill-opacity="0.04" stroke="#FFFFFF" stroke-opacity="0.09" stroke-width="1"/>
<text x="638" y="566" font-size="17" font-weight="700" fill="#E8ECF8">Top languages by commit</text>
${sortedByteLangs.map((l, i) => `
<circle cx="644" cy="${611 + i * 31}" r="5" fill="${l.color}"/>
<text x="662" y="${616 + i * 31}" font-size="14" fill="#E8ECF8">${l.name}</text>
<text x="872" y="${616 + i * 31}" text-anchor="end" font-size="14" font-weight="600" fill="#8B94B3">${l.percent}%</text>
`).join('')}
<circle cx="1020" cy="668" r="68" fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="26"/>
${donutCommitSvg}
<g style="animation:k46 14.0s infinite">
  <text x="1020" y="672" text-anchor="middle" font-size="24" font-weight="800" fill="url(#numfill)">${sortedByteLangs[0].percent}%</text>
  <text x="1020" y="690" text-anchor="middle" font-size="12" fill="#8B94B3">${sortedByteLangs[0].name}</text>
</g>

</g>
</svg>`;

  const outPath = path.resolve(__dirname, '../assets/github-stats.svg');
  fs.writeFileSync(outPath, svgContent, 'utf8');
  console.log(`Successfully generated and updated ${outPath}`);
}

main().catch(err => {
  console.error('Update failed:', err);
  process.exit(1);
});
