/**
 * The course providers whose pages the app will link to, in one place.
 *
 * A course link Claude suggests is shown as "Open course" only if it is https,
 * on one of these domains (or a subdomain of one), and passes the checks in
 * shared/courseLinks.ts. Any other link is replaced by a search for the course
 * name: on the named provider's own site search when we know it, or a web
 * search limited to the provider's site when it has no search page we can
 * link to, or a plain web search when the provider is not on this list.
 *
 * To add a provider: its name as students know it, the names Claude may use
 * for it (lowercase), the domains its course pages live on, and how to search
 * it. Keep it to real course platforms and official certification bodies.
 *
 * Pure: no Vite, no DOM, no Node (the Vercel function imports it).
 */

export interface CourseProvider {
    /** Shown on the fallback link: "Search on <name>". */
    name: string;
    /** Lowercase names Claude may use for it; the longest one found in its answer wins. */
    aliases: string[];
    /** Hosts whose pages count; a subdomain of one counts too. */
    domains: string[];
    /** Only paths under this prefix are course pages (LinkedIn Learning lives under linkedin.com/learning/). */
    pathPrefix?: string;
    /** Paths on this site that are topic or listing pages, never one course (edX's /learn/<topic>). */
    notCourse?: RegExp[];
    /** The provider's own search page for a query, or null to search the web within `domains[0]`. */
    search: ((query: string) => string) | null;
    /**
     * Where Claude's web search may look for this provider's courses, when not
     * all of `domains` (redirect-only or rarely useful hosts are left out to
     * keep the list under MAX_SEARCH_DOMAINS). Links are still checked against
     * `domains`.
     */
    searchDomains?: string[];
}

const q = encodeURIComponent;

export const COURSE_PROVIDERS: readonly CourseProvider[] = [
    // Course platforms
    { name: 'Coursera', aliases: ['coursera'], domains: ['coursera.org'], search: (s) => `https://www.coursera.org/search?query=${q(s)}` },
    { name: 'edX', aliases: ['edx'], domains: ['edx.org'], notCourse: [/^\/learn\/[^/]+\/?$/], search: (s) => `https://www.edx.org/search?q=${q(s)}` },
    { name: 'LinkedIn Learning', aliases: ['linkedin learning', 'linkedin', 'lynda'], domains: ['linkedin.com'], pathPrefix: '/learning/', search: (s) => `https://www.linkedin.com/learning/search?keywords=${q(s)}` },
    { name: 'Udemy', aliases: ['udemy'], domains: ['udemy.com'], search: (s) => `https://www.udemy.com/courses/search/?q=${q(s)}` },
    { name: 'Khan Academy', aliases: ['khan academy'], domains: ['khanacademy.org'], search: (s) => `https://www.khanacademy.org/search?page_search_query=${q(s)}` },
    { name: 'FutureLearn', aliases: ['futurelearn'], domains: ['futurelearn.com'], search: (s) => `https://www.futurelearn.com/search?q=${q(s)}` },
    { name: 'Pluralsight', aliases: ['pluralsight'], domains: ['pluralsight.com'], search: (s) => `https://www.pluralsight.com/search?q=${q(s)}` },
    { name: 'DataCamp', aliases: ['datacamp'], domains: ['datacamp.com'], search: (s) => `https://www.datacamp.com/courses-all?q=${q(s)}` },
    { name: 'Udacity', aliases: ['udacity'], domains: ['udacity.com'], search: null },
    { name: 'MIT OpenCourseWare', aliases: ['mit opencourseware', 'mit ocw', 'opencourseware'], domains: ['ocw.mit.edu'], search: (s) => `https://ocw.mit.edu/search/?q=${q(s)}` },
    { name: 'Harvard Online', aliases: ['harvard online', 'harvardx', 'harvard business school online', 'harvard'], domains: ['pll.harvard.edu', 'online.hbs.edu', 'harvardonline.harvard.edu'], search: null },
    { name: 'Stanford Online', aliases: ['stanford online', 'stanford'], domains: ['online.stanford.edu'], search: null },
    { name: 'eCornell', aliases: ['ecornell', 'cornell'], domains: ['ecornell.cornell.edu'], search: null },
    { name: 'Wharton Online', aliases: ['wharton online', 'wharton'], domains: ['online.wharton.upenn.edu', 'executiveeducation.wharton.upenn.edu'], searchDomains: ['online.wharton.upenn.edu'], search: null },
    { name: 'DeepLearning.AI', aliases: ['deeplearning.ai', 'deeplearning ai'], domains: ['deeplearning.ai'], search: null },
    { name: 'O’Reilly', aliases: ['o\'reilly learning', 'o\'reilly media', 'o\'reilly', 'o’reilly', 'oreilly'], domains: ['oreilly.com'], search: (s) => `https://www.oreilly.com/search/?q=${q(s)}` },
    { name: 'Becker', aliases: ['becker professional education', 'becker'], domains: ['becker.com'], search: null },
    { name: 'Kaggle', aliases: ['kaggle learn', 'kaggle'], domains: ['kaggle.com'], pathPrefix: '/learn/', search: null },

    // Company academies
    { name: 'Google', aliases: ['google career certificates', 'grow with google', 'google skillshop', 'skillshop', 'google'], domains: ['grow.google', 'skillshop.withgoogle.com', 'learndigital.withgoogle.com', 'developers.google.com'], searchDomains: ['grow.google', 'withgoogle.com'], search: null },
    { name: 'Google Cloud Skills Boost', aliases: ['google cloud skills boost', 'google cloud'], domains: ['skills.google', 'cloudskillsboost.google', 'cloud.google.com'], searchDomains: ['skills.google', 'cloud.google.com'], search: (s) => `https://www.skills.google/catalog?keywords=${q(s)}` },
    { name: 'Microsoft Learn', aliases: ['microsoft learn', 'microsoft'], domains: ['learn.microsoft.com'], search: (s) => `https://learn.microsoft.com/en-us/search/?terms=${q(s)}` },
    { name: 'AWS', aliases: ['aws skill builder', 'aws training', 'amazon web services', 'aws'], domains: ['aws.amazon.com', 'skillbuilder.aws', 'explore.skillbuilder.aws', 'aws.training'], searchDomains: ['aws.amazon.com', 'skillbuilder.aws'], search: (s) => `https://aws.amazon.com/search/?searchQuery=${q(s)}` },
    { name: 'IBM SkillsBuild', aliases: ['ibm skillsbuild', 'ibm'], domains: ['skillsbuild.org', 'ibm.com'], search: null },
    { name: 'Salesforce Trailhead', aliases: ['salesforce trailhead', 'trailhead', 'salesforce'], domains: ['trailhead.salesforce.com'], search: (s) => `https://trailhead.salesforce.com/search?keywords=${q(s)}` },
    { name: 'HubSpot Academy', aliases: ['hubspot academy', 'hubspot'], domains: ['academy.hubspot.com'], search: null },
    { name: 'Cisco Networking Academy', aliases: ['cisco networking academy', 'netacad', 'cisco'], domains: ['netacad.com', 'cisco.com'], searchDomains: ['netacad.com'], search: null },
    { name: 'Tableau', aliases: ['tableau'], domains: ['tableau.com'], search: null },
    { name: 'Adobe', aliases: ['adobe'], domains: ['adobe.com', 'learning.adobe.com'], searchDomains: [], search: null },

    // Official certification bodies
    { name: 'PMI', aliases: ['project management institute', 'pmi'], domains: ['pmi.org'], search: null },
    { name: 'SHRM', aliases: ['society for human resource management', 'shrm'], domains: ['shrm.org'], search: null },
    { name: 'HRCI', aliases: ['hr certification institute', 'hrci'], domains: ['hrci.org'], search: null },
    { name: 'CFA Institute', aliases: ['cfa institute'], domains: ['cfainstitute.org'], search: null },
    { name: 'AICPA & CIMA', aliases: ['aicpa & cima', 'aicpa and cima', 'aicpa', 'cima'], domains: ['aicpa-cima.com', 'aicpa.org'], searchDomains: ['aicpa-cima.com'], search: null },
    { name: 'The IIA', aliases: ['institute of internal auditors', 'the iia', 'iia'], domains: ['theiia.org'], search: null },
    { name: 'ISACA', aliases: ['isaca'], domains: ['isaca.org'], search: null },
    { name: 'ISC2', aliases: ['(isc)²', '(isc)2', 'isc2'], domains: ['isc2.org'], search: null },
    { name: 'CompTIA', aliases: ['comptia'], domains: ['comptia.org'], search: null },
    { name: 'ASCM', aliases: ['association for supply chain management', 'ascm', 'apics'], domains: ['ascm.org'], search: null },
    { name: 'IMA', aliases: ['institute of management accountants', 'ima'], domains: ['imanet.org'], search: null },
    { name: 'ACFE', aliases: ['association of certified fraud examiners', 'acfe'], domains: ['acfe.com'], search: null },
    { name: 'FINRA', aliases: ['finra'], domains: ['finra.org'], search: null },
    { name: 'Scrum.org', aliases: ['scrum.org'], domains: ['scrum.org'], search: null },
    { name: 'Scrum Alliance', aliases: ['scrum alliance'], domains: ['scrumalliance.org'], search: null },
    { name: 'PeopleCert', aliases: ['peoplecert', 'axelos'], domains: ['peoplecert.org', 'axelos.com'], searchDomains: ['peoplecert.org'], search: null },
    { name: 'IIBA', aliases: ['international institute of business analysis', 'iiba'], domains: ['iiba.org'], search: null },
    { name: 'AMA', aliases: ['american marketing association'], domains: ['ama.org'], search: null },
    { name: 'AHIMA', aliases: ['ahima'], domains: ['ahima.org'], search: null },
    { name: 'ANCC', aliases: ['american nurses credentialing center', 'ancc', 'american nurses association'], domains: ['nursingworld.org'], search: null },
    { name: 'AACN', aliases: ['american association of critical-care nurses', 'aacn'], domains: ['aacn.org'], search: null },
    { name: 'American Red Cross', aliases: ['american red cross', 'red cross'], domains: ['redcross.org'], search: null },
    { name: 'American Heart Association', aliases: ['american heart association'], domains: ['heart.org', 'cpr.heart.org'], search: null },
    { name: 'OSHA', aliases: ['osha training institute', 'osha'], domains: ['osha.gov'], search: null },
    { name: 'NCCER', aliases: ['nccer'], domains: ['nccer.org'], search: null },
    { name: 'American Welding Society', aliases: ['american welding society'], domains: ['aws.org'], search: null },
    { name: 'ASE', aliases: ['national institute for automotive service excellence', 'ase'], domains: ['ase.com'], search: null },
    { name: 'ServSafe', aliases: ['servsafe', 'national restaurant association'], domains: ['servsafe.com'], search: null },
    { name: 'NASM', aliases: ['national academy of sports medicine', 'nasm'], domains: ['nasm.org'], search: null },
    { name: 'ACE', aliases: ['american council on exercise'], domains: ['acefitness.org'], search: null },
];

/** Kept at or under the 64 hostnames Anthropic documents for web tool domain lists. */
export const MAX_SEARCH_DOMAINS = 64;

/**
 * The `allowed_domains` of the web search Claude runs for course features
 * (a function, so the browser bundle, which never needs it, can leave it out):
 * each provider's search domains, LinkedIn and Kaggle limited to their course
 * paths, with any host already covered by another entry left out.
 */
export function courseSearchDomains(): string[] {
    const all = COURSE_PROVIDERS.flatMap((p) =>
        (p.searchDomains ?? p.domains).map((d) => (p.pathPrefix ? `${d}${p.pathPrefix.replace(/\/$/, '')}` : d)));
    const hosts = all.filter((d) => !d.includes('/'));
    return [...new Set(all)].filter((d) => !hosts.some((h) => h !== d && d.split('/')[0].endsWith(`.${h}`)));
}

/** A web search, for a provider not on the list. */
export const webSearchUrl = (query: string): string => `https://www.google.com/search?q=${q(query)}`;
