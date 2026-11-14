// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiLimitError, callClaudeFeature, getClaudeUserFriendlyMessage } from '../utils/claude';

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const htmlChallenge = () => new Response('<!DOCTYPE html><html>Vercel Security Checkpoint</html>', { status: 403, headers: { 'content-type': 'text/html' } });

const input = { roleKey: 'soc:43-4051', title: 'Customer Service Representatives', tasks: ['Answer calls'], employment: 1, projectedGrowth: 0 };

afterEach(() => vi.unstubAllGlobals());

describe('AI requests retry quietly before showing an error', () => {
    it('a Vercel edge challenge (HTML 403) is retried and the answer still arrives', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(htmlChallenge())
            .mockResolvedValueOnce(json({ result: { strategic_insight: 'ok' } }));
        vi.stubGlobal('fetch', fetchMock);
        const { result } = await callClaudeFeature<{ strategic_insight: string }>('analyze', input);
        expect(result.strategic_insight).toBe('ok');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('a network error and a 502 are retried', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(json({ error: { type: 'foj_upstream', message: 'overloaded' } }, 502))
            .mockResolvedValueOnce(json({ result: { strategic_insight: 'ok' } }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(callClaudeFeature('analyze', input)).resolves.toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('gives up after three tries with a plain message, not "Analysis unavailable"', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => json({ error: { type: 'foj_upstream', message: 'down' } }, 503));
        vi.stubGlobal('fetch', fetchMock);
        const err = await callClaudeFeature('analyze', input).catch((e) => e);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(getClaudeUserFriendlyMessage(err)).toBe("Couldn't reach the AI right now. Please try again in a minute.");
    });

    it('retries a rejected Claude answer (502 foj_invalid_answer) once, never more: at most 2 paid calls per click', async () => {
        const invalid = vi.fn().mockImplementation(async () => json({ error: { type: 'foj_invalid_answer', message: 'did not pass the checks' } }, 502));
        vi.stubGlobal('fetch', invalid);
        await expect(callClaudeFeature('analyze', input)).rejects.toThrow();
        expect(invalid).toHaveBeenCalledTimes(2);

        const thenOk = vi.fn()
            .mockResolvedValueOnce(json({ error: { type: 'foj_invalid_answer', message: 'x' } }, 502))
            .mockResolvedValueOnce(json({ result: { strategic_insight: 'ok' } }));
        vi.stubGlobal('fetch', thenOk);
        await expect(callClaudeFeature('analyze', input)).resolves.toBeTruthy();
        expect(thenOk).toHaveBeenCalledTimes(2);

        // An upstream fault (Claude down) still gets the full two retries.
        const down = vi.fn().mockImplementation(async () => json({ error: { type: 'foj_upstream', message: 'overloaded' } }, 502));
        vi.stubGlobal('fetch', down);
        await expect(callClaudeFeature('analyze', input)).rejects.toThrow();
        expect(down).toHaveBeenCalledTimes(3);
    });

    it('never retries the visitor limit (429) or a refused request (400)', async () => {
        const limited = vi.fn().mockResolvedValue(json({ error: { type: 'foj_rate_limited', message: 'limit', retryAfterSeconds: 60 } }, 429));
        vi.stubGlobal('fetch', limited);
        await expect(callClaudeFeature('analyze', input)).rejects.toBeInstanceOf(AiLimitError);
        expect(limited).toHaveBeenCalledTimes(1);

        const refused = vi.fn().mockResolvedValue(json({ error: { type: 'foj_bad_request', message: 'no' } }, 400));
        vi.stubGlobal('fetch', refused);
        await expect(callClaudeFeature('analyze', input)).rejects.toThrow();
        expect(refused).toHaveBeenCalledTimes(1);
    });

    it('a JSON 403 from our own gateway is a refusal, not retried', async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ error: { type: 'foj_not_allowed', message: 'This is not a request the app makes.' } }, 403));
        vi.stubGlobal('fetch', fetchMock);
        await expect(callClaudeFeature('analyze', input)).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
