/**
 * The key and workspace for `generate-bls-scores --direct`, which calls
 * https://api.anthropic.com/v1/messages itself instead of going through the
 * app proxy.
 *
 *   key        env FOJ_SCORING_API_KEY, else the file ~/.foj_scoring_key
 *   workspace  env FOJ_SCORING_WORKSPACE, else the file ~/.foj_scoring_workspace
 *
 * Both are required: the owner's key is a user key with no workspace scope, so
 * every call needs the anthropic-workspace-id header. ANTHROPIC_API_KEY is
 * never read, so the app's own key in .env can't be picked up by mistake.
 * Nothing here prints, logs or returns the key in a message.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Auth } from './claudeScoring';

export const KEY_ENV = 'FOJ_SCORING_API_KEY';
export const WORKSPACE_ENV = 'FOJ_SCORING_WORKSPACE';
export const KEY_FILE = '.foj_scoring_key';
export const WORKSPACE_FILE = '.foj_scoring_workspace';

export interface DirectAuthSources {
    env?: Record<string, string | undefined>;
    home?: string;
    readFile?: (file: string) => string | null;
}

export type DirectAuth = Extract<Auth, { mode: 'direct' }> & { workspace: string; keySource: string; workspaceSource: string };

const readIfPresent = (file: string): string | null => {
    try {
        return fs.readFileSync(file, 'utf-8');
    } catch {
        return null;
    }
};

function pick(name: string, envName: string, fileName: string, src: Required<DirectAuthSources>): { value: string; source: string } {
    const fromEnv = src.env[envName]?.trim();
    if (fromEnv) return { value: fromEnv, source: `env ${envName}` };
    const file = path.join(src.home, fileName);
    const fromFile = src.readFile(file)?.trim();
    if (fromFile) return { value: fromFile, source: `~/${fileName}` };
    throw new Error(`No ${name}: set ${envName} or put it in ~/${fileName}.`);
}

/** Throws (without the secret in the message) when either value is missing or malformed. */
export function loadDirectAuth(sources: DirectAuthSources = {}): DirectAuth {
    const src: Required<DirectAuthSources> = {
        env: sources.env ?? process.env,
        home: sources.home ?? os.homedir(),
        readFile: sources.readFile ?? readIfPresent,
    };
    const key = pick('API key', KEY_ENV, KEY_FILE, src);
    if (/\s/.test(key.value)) throw new Error(`The API key from ${key.source} contains whitespace; it should be one line with no spaces.`);
    const workspace = pick('workspace ID', WORKSPACE_ENV, WORKSPACE_FILE, src);
    if (!/^wrkspc_[A-Za-z0-9]+$/.test(workspace.value)) {
        throw new Error(`The workspace ID from ${workspace.source} does not look like wrkspc_...`);
    }
    return { mode: 'direct', key: key.value, workspace: workspace.value, keySource: key.source, workspaceSource: workspace.source };
}
