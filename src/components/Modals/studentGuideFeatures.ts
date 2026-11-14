/**
 * The Student Guide's feature cards: shown by StudentGuideModal and copied
 * word for word into public/student-guide.html (and its PDF), which
 * studentGuide.test.ts checks. Coverage wording comes from the data
 * (utils/blsScores, utils/stateMapData), never typed in.
 *
 * The printed guide cannot change by itself, so every sentence here is true
 * both before and after the Kelley SOCs are re-scored (--batch kelley): the
 * counts it quotes are the same in both, and the task rules and score dates,
 * which do change, are explained once, in Methodology (Sources), from the data.
 */

import { SCORE_COUNTS, SCORE_COVERAGE } from '../../utils/blsScores';
import { STATE_MAP_COVERAGE } from '../../utils/stateMapData';

const MORE_SCORED = SCORE_COUNTS.bls > 0;
const SLATE = SCORE_COVERAGE.slate ? ` Slate peaks${SCORE_COVERAGE.slate}` : '';
const n = (v: number) => v.toLocaleString('en-US');
const RANKED = n(SCORE_COUNTS.ranked);
const KELLEY = n(SCORE_COUNTS.kelleyTitles);

export interface Feature {
    emoji: string;
    title: string;
    description: string;
    tip: string;
    color: string;
}

export const FEATURES: Feature[] = [
    {
        emoji: '🏔️',
        title: '3D Terrain Map',
        description:
            'The map is one landscape split into 22 fields: the BLS major occupation groups, from Arts & Media to Healthcare and Construction. A field\'s area is its share of all U.S. workers in 2025 (BLS Employment Projections, self-employed included). The fields are grouped by the five official BLS job families, outlined on the map: area is workers, while positions within a family follow BLS code order, so where a field sits and its shape are only layout. Inside each field, related occupations sit together: each BLS minor group has its own block, in code order. Each peak is one occupation, and its height is its number of jobs from BLS Employment Projections. Open a family or a field and the map zooms into it: the same block, magnified, with every occupation next to the same neighbours (inside a field it is also drawn closer to a square so its labels can be read). What you have open is drawn on one fixed scale: the largest job count any of its occupations reaches from 2025 to 2035 is full height. Each hill rises or falls with its own BLS number as you move the slider, though a small hill on a larger neighbour\'s slope can move with that neighbour. Compare heights within what you have open.',
        tip: 'Click a job family to zoom into it, then a field to see its occupations, or pick any field from the All 22 fields button. The largest are labelled; hover or tap any other peak for its name. Back, Esc or the trail next to that button takes you back up, and the line under it gives the numbers for what you have open.',
        color: 'cyan',
    },
    {
        emoji: '⏱️',
        title: 'AI Timeline Slider',
        description:
            'Drag the slider from 2025 → 2035 to watch each occupation\'s BLS Employment Projections job count year by year. Height moves in a straight line between the official 2025 and 2035 employment levels — no AI forecast on the landscape.',
        tip: 'Compare Registered Nurses with Retail Salespersons at 2035. Notice which peak grows and which shrinks, then open both to compare.',
        color: 'purple',
    },
    {
        emoji: '🎓',
        title: 'Fields & Kelley Roles',
        description:
            MORE_SCORED
                ? `${SCORE_COVERAGE.sentence} They are drawn in their AI exposure colours. It is one app for every scored role: each opens the same panel with the same features, and the ${KELLEY} Kelley roles carry a small Kelley label.${SLATE} Nothing is shown in place of a missing score.`
                : `AI scores currently cover the ${KELLEY} Kelley business roles, drawn in their AI exposure colours. Every other occupation is drawn in slate: its AI scores are coming soon, and nothing is shown in their place.`,
        tip: `Search any job title in the header: all ${n(SCORE_COUNTS.total)} BLS occupations are there, from Actors to Electricians.`,
        color: 'orange',
    },
    {
        emoji: '📋',
        title: 'Job Detail Panel',
        description:
            'Inside a field, click any peak to open its panel: what the job involves (O*NET), how many people do it (BLS Employment Projections, 2025, self-employed included), median pay (BLS OEWS, payroll employees only), the BLS 2025–35 growth outlook, and its day-to-day O*NET tasks. For every scored role the panel also shows AI Exposure, Human Criticality and Human Resilience, with an AI Exposure score on every rated task, plus Roadmap, Scenario, Defend / Build and Save role. AI Exposure is the plain average of those task scores, so you can check it yourself.' +
            (MORE_SCORED ? ` Human Resilience ranks the role among all ${RANKED} scored occupations.` : ''),
        tip: 'Two worker counts are normal: pay comes from payroll employees only, while "workers" counts everyone, self-employed included. Scores measure GenAI capability, not guaranteed adoption.',
        color: 'blue',
    },
    {
        emoji: '🧩',
        title: 'Tasks View',
        description:
            'Open Tasks in the header to see every scored role in the field you have open (or the whole map) broken into AI-capable vs human-needed work. Roles are ordered by average GenAI capability today — not guaranteed adoption. Use “Same score, different jobs” pairs to make the contrast concrete.',
        tip: 'Capability labels are Claude judgments of what GenAI can handle, not a forecast that the work is already automated.',
        color: 'indigo',
    },
    {
        emoji: '🤖',
        title: 'AI Analysis',
        description:
            'Open any scored role and Claude explains its published scores right in the panel: the reasoning under each task, a strategic insight for the role, and the likely replacements and human traits it calls for. The analysis adds the explanation; it never changes the numbers. Claude writes it the first time anyone opens the role. When the app\'s answer saving is on, it is saved, so every later visitor sees the same answer. ' +
            (SCORE_COUNTS.unscored > 0
                ? 'Occupations without published scores have no analysis.'
                : ''),
        tip: 'Every student sees the same published scores for a role; the AI Scores badge in the header shows the months they were made. With saving on, everyone also sees the same saved analysis, so you can compare notes. The analysis is where you get the why behind them.',
        color: 'red',
    },
    {
        emoji: '🔮',
        title: 'Scenario Planning',
        description:
            'On any scored role, the Scenario button writes a day in the life of that job in 2030: how the work is shared with AI, and what people in it focus on instead, with the key changes. Like the analysis, it is written once and, when saving is on, saved for everyone.',
        tip: 'Use this to stress-test career choices. Ask the same role under two different scenarios and compare the outlooks.',
        color: 'violet',
    },
    {
        emoji: '🗺️',
        title: 'Career Roadmap',
        description:
            'On any scored role, identifies the task most exposed to AI and builds a 6-month plan to defend it — own the judgment and oversight around the automatable work — while deepening a human-critical task. Covers skills, tools, and learning resources. Written once per role and, when saving is on, saved so everyone sees the same plan.',
        tip: 'Open it with the Roadmap button on the role panel. Defend = supervise the task most exposed to AI; Build = deepen the human-critical one.',
        color: 'orange',
    },
    {
        emoji: '🎯',
        title: 'My Skills (CV Match)',
        description:
            'Paste your CV or a list of your skills. The app analyses which roles align with your strengths and flags where you are most exposed to AI.',
        tip: 'Honest input = honest output. List the skills you actually have, not the ones you wish you had.',
        color: 'emerald',
    },
    {
        emoji: '🗺️',
        title: 'US Map View',
        description:
            `Switch from the 3D terrain to a flat 2D US map of every job in the field you have open (or the whole map): all ${n(STATE_MAP_COVERAGE.jobs)} jobs are on it, Kelley or not. State colour and circle size both show BLS employment: the brighter the colour and the bigger the circle, the more workers in that state for the selected roles. Grey means BLS publishes no number for them in that state. Hover a state to see the exact BLS OEWS May 2025 employment count and Location Quotient (LQ) per occupation.`,
        tip: 'Select specific roles using the role filter before opening the map to compare which states are most exposed for those jobs in particular.',
        color: 'teal',
    },
    {
        emoji: '📊',
        title: 'Job Security Index',
        description:
            `The colour legend at the bottom right of the screen maps the scored roles into three bands: High AI Exposure (red), Hybrid/Augmented (amber), and Safe Human-Centric (green). Bands are relative, graded on a curve across all ${RANKED} scored occupations (each BLS code once), a third in each.` + (SLATE || ' Slate peaks are occupations with no AI scores yet.'),
        tip: 'A "green" role here means it is safer than most others in this dataset, not that it is completely immune to automation.',
        color: 'green',
    },
    {
        emoji: '📚',
        title: 'Data Sources',
        description:
            'Workers in each occupation and each field come from the BLS Employment Projections 2025–35, which count everyone, self-employed included; growth outlooks come from the same projections. Pay comes from the BLS Occupational Employment & Wage Statistics (OEWS, May 2025), which covers payroll employees only. Task descriptions are from O*NET 30.1. AI Exposure scores are Claude\'s ratings of the tasks of ' + (MORE_SCORED ? `${n(SCORE_COUNTS.scored)} occupations, the ${KELLEY} Kelley roles among them` : `the ${KELLEY} Kelley roles`) + ', published with the app, so every student sees the same numbers. Sources explains which tasks each job is scored on and when.' + (MORE_SCORED
                ? (SCORE_COVERAGE.unscoredReason ? ` ${SCORE_COVERAGE.unscoredReason}` : '')
                : ' Scores for the other occupations are coming soon.'),
        tip: 'Click "Sources" at the bottom of the screen to read the full sourcing and calculation methodology.',
        color: 'gray',
    },
];
