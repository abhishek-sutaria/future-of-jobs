/**
 * The course providers whose pages the app will link to, in one place.
 *
 * A course link Claude suggests is shown as "Open course" only if it is https,
 * on one of these domains (or a subdomain of one), and passes the checks in
 * shared/courseLinks.ts. Any other course is shown with no link (no search
 * fallback since 2026-11-22: the owner wants only direct links).
 *
 * To add a provider: its name as students know it and the domains its course
 * pages live on. Keep it to real course platforms and official certification
 * bodies.
 *
 * Pure: no Vite, no DOM, no Node (the Vercel function imports it).
 */

export interface CourseProvider {
    /** The provider's name as students know it (the catalog's `provider`). */
    name: string;
    /** Hosts whose pages count; a subdomain of one counts too. */
    domains: string[];
    /** Only paths under this prefix are course pages (LinkedIn Learning lives under linkedin.com/learning/). */
    pathPrefix?: string;
    /** Paths on this site that are topic or listing pages, never one course (edX's /learn/<topic>). */
    notCourse?: RegExp[];
}

export const COURSE_PROVIDERS: readonly CourseProvider[] = [
    // Course platforms
    { name: 'Coursera', domains: ['coursera.org'] },
    { name: 'edX', domains: ['edx.org'], notCourse: [/^\/learn\/[^/]+\/?$/] },
    { name: 'LinkedIn Learning', domains: ['linkedin.com'], pathPrefix: '/learning/' },
    { name: 'Udemy', domains: ['udemy.com'] },
    { name: 'Khan Academy', domains: ['khanacademy.org'] },
    { name: 'FutureLearn', domains: ['futurelearn.com'] },
    { name: 'Pluralsight', domains: ['pluralsight.com'] },
    { name: 'DataCamp', domains: ['datacamp.com'] },
    { name: 'Udacity', domains: ['udacity.com'] },
    { name: 'MIT OpenCourseWare', domains: ['ocw.mit.edu'] },
    { name: 'Harvard Online', domains: ['pll.harvard.edu', 'online.hbs.edu', 'harvardonline.harvard.edu'] },
    { name: 'Stanford Online', domains: ['online.stanford.edu'] },
    { name: 'eCornell', domains: ['ecornell.cornell.edu'] },
    { name: 'Wharton Online', domains: ['online.wharton.upenn.edu', 'executiveeducation.wharton.upenn.edu'] },
    { name: 'DeepLearning.AI', domains: ['deeplearning.ai'] },
    { name: 'O’Reilly', domains: ['oreilly.com'] },
    { name: 'Becker', domains: ['becker.com'] },
    { name: 'Kaggle', domains: ['kaggle.com'], pathPrefix: '/learn/' },

    // Company academies
    { name: 'Google', domains: ['grow.google', 'skillshop.withgoogle.com', 'learndigital.withgoogle.com', 'developers.google.com'] },
    { name: 'Google Cloud Skills Boost', domains: ['skills.google', 'cloudskillsboost.google', 'cloud.google.com'] },
    { name: 'Microsoft Learn', domains: ['learn.microsoft.com'] },
    { name: 'AWS', domains: ['aws.amazon.com', 'skillbuilder.aws', 'explore.skillbuilder.aws', 'aws.training'] },
    { name: 'IBM SkillsBuild', domains: ['skillsbuild.org', 'ibm.com'] },
    { name: 'Salesforce Trailhead', domains: ['trailhead.salesforce.com'] },
    { name: 'HubSpot Academy', domains: ['academy.hubspot.com'] },
    { name: 'Cisco Networking Academy', domains: ['netacad.com', 'cisco.com'] },
    { name: 'Tableau', domains: ['tableau.com'] },
    { name: 'Adobe', domains: ['adobe.com', 'learning.adobe.com'] },

    // Official certification bodies
    { name: 'PMI', domains: ['pmi.org'] },
    { name: 'SHRM', domains: ['shrm.org'] },
    { name: 'HRCI', domains: ['hrci.org'] },
    { name: 'CFA Institute', domains: ['cfainstitute.org'] },
    { name: 'AICPA & CIMA', domains: ['aicpa-cima.com', 'aicpa.org'] },
    { name: 'The IIA', domains: ['theiia.org'] },
    { name: 'ISACA', domains: ['isaca.org'] },
    { name: 'ISC2', domains: ['isc2.org'] },
    { name: 'CompTIA', domains: ['comptia.org'] },
    { name: 'ASCM', domains: ['ascm.org'] },
    { name: 'IMA', domains: ['imanet.org'] },
    { name: 'ACFE', domains: ['acfe.com'] },
    { name: 'FINRA', domains: ['finra.org'] },
    { name: 'Scrum.org', domains: ['scrum.org'] },
    { name: 'Scrum Alliance', domains: ['scrumalliance.org'] },
    { name: 'PeopleCert', domains: ['peoplecert.org', 'axelos.com'] },
    { name: 'IIBA', domains: ['iiba.org'] },
    { name: 'AMA', domains: ['ama.org'] },
    { name: 'AHIMA', domains: ['ahima.org'] },
    { name: 'ANCC', domains: ['nursingworld.org'] },
    { name: 'AACN', domains: ['aacn.org'] },
    { name: 'American Red Cross', domains: ['redcross.org'] },
    { name: 'American Heart Association', domains: ['heart.org', 'cpr.heart.org'] },
    { name: 'OSHA', domains: ['osha.gov'] },
    { name: 'NCCER', domains: ['nccer.org'] },
    { name: 'American Welding Society', domains: ['aws.org'] },
    { name: 'ASE', domains: ['ase.com'] },
    { name: 'ServSafe', domains: ['servsafe.com'] },
    { name: 'NASM', domains: ['nasm.org'] },
    { name: 'ACE', domains: ['acefitness.org'] },
];

