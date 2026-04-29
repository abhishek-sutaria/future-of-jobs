/**
 * Game Mechanics & Logic Configuration
 * Centralized source of truth for simulation math.
 */

export const UPSKILL_IMPACT = {
    // How much Human Criticality increases per training session
    HUMAN_SCORE_BOOST: 0.2,

    // How much AI Capability (Risk) coverage decreases per session
    AI_SCORE_REDUCTION: 0.1
};

export const VISUALIZATION_THRESHOLDS = {
    // Used for "Safe Zone" rendering in charts
    SAFE_ZONE_MIN_HUMAN_SCORE: 0.5,
    DANGER_ZONE_MIN_AI_SCORE: 0.5
};

export const RESILIENCE_SCORES = {
    COURSE_COMPLETION_BONUS: 15
};
