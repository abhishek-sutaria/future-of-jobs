/**
 * The dates of the published AI scores the app shows, from the data: the
 * header badge and the Student Guide line about it both read these.
 */

import { BLS_SCORES_META, monthRangeLabel, publishedScoreDates, scoredRangeLabel } from './blsScores';
import { LEGACY_SCORES_DATE } from './bakedScores';

export const PUBLISHED_SCORE_DATES = publishedScoreDates(BLS_SCORES_META, LEGACY_SCORES_DATE);

/** "Aug–Nov 2026": the badge's months. */
export const SCORES_BADGE_MONTHS: string | null = monthRangeLabel(PUBLISHED_SCORE_DATES.first, PUBLISHED_SCORE_DATES.last);

/** "August 20 to November 8, 2026": the badge's tooltip. */
export const SCORES_DATE_RANGE: string | null = scoredRangeLabel(PUBLISHED_SCORE_DATES.first, PUBLISHED_SCORE_DATES.last);
