/**
 * DATA_VERSION: the data the app's numbers come from, in one string. It is
 * part of every saved shared answer's key (api/_lib/sharedAnswers.ts), so a
 * data refresh (a new BLS or O*NET vintage, or a re-score) makes every saved
 * answer a miss: each role's next visitor gets a fresh answer, saved again.
 *
 * Built from the vintages the app shows (config/constants DATA_SOURCES) plus
 * the scores file's header (src/data/ai_scores_bls.json version and
 * generatedAt). The scores file is too big for the server function to load,
 * so its header is copied here; dataVersion.test.ts fails if the copy and the
 * file ever differ, so a re-score cannot forget to change it.
 *
 * Live BLS numbers (CPS unemployment) and the state map are not in it: they
 * never reach a saved answer's prompt.
 */

import { DATA_SOURCES } from '../config/constants.js';

/** src/data/ai_scores_bls.json `version` and `generatedAt` (checked by dataVersion.test.ts). */
export const SCORES_VINTAGE = { version: 5, generatedAt: '2026-11-09T05:34:00.988Z' } as const;

/** Each part of DATA_VERSION, in order. */
export const DATA_VINTAGES = {
    oews: DATA_SOURCES.BLS_OES,
    oewsWages: DATA_SOURCES.BLS_OES_WAGES,
    ep: DATA_SOURCES.BLS_EP,
    ooh: DATA_SOURCES.BLS_OOH,
    onet: DATA_SOURCES.ONET,
    scores: `scores-v${SCORES_VINTAGE.version}@${SCORES_VINTAGE.generatedAt}`,
} as const;

export const DATA_VERSION: string = Object.entries(DATA_VINTAGES).map(([k, v]) => `${k}=${v}`).join(';');
