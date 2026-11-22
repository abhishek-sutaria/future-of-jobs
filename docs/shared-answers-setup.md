# Turn on saved answers (one-time setup, about 15 minutes)

When saved answers are on, the first visitor who opens a job's Strategic Insight, Scenario, Roadmap or Defend / Build gets a new answer from Claude. That answer is saved, and every later visitor gets the same answer at once, with no new Claude call and no cost.

Answers refresh on their own. A saved answer is made again when it is more than 90 days old, or when the job data, the prompt or the Claude model changes.

This needs a **new, free Supabase project** that only the server uses. Visitor accounts stay in the old project. Do not change anything there.

You need: a Supabase login (free) and access to the project in Vercel.

---

## 1. Create a free Supabase project

1. Go to https://supabase.com/dashboard and sign in (or sign up, free).
2. Click **New project**.
3. Pick your organization. Name: `future-of-jobs-answers`.
4. **Database password**: click **Generate a password**. Save it in your password manager. The app never needs it, but Supabase asks for it.
5. Region: **East US** (or the one closest to most visitors).
6. Plan: **Free**. Click **Create new project** and wait 1 to 2 minutes until it says the project is ready.

## 2. Paste the SQL (once)

1. In the left sidebar, click **SQL Editor**.
2. Click **New query** (or the **+** button).
3. Open `supabase/setup_shared_answers.sql` from this repo on GitHub, click **Raw**, select all and copy it.
4. Paste it into the empty query box and click **Run** (or press Cmd+Enter / Ctrl+Enter).
5. You should see **Success. No rows returned**. If Supabase warns that the query has "destructive operations", that is fine: the file deletes nothing. Click to run it anyway.

Running it a second time is safe. It changes nothing that is already there.

## 3. Copy the Project URL and the secret key

1. Click the **gear icon (Project Settings)** at the bottom of the left sidebar.
2. **Project URL**: open **Data API** (or **API**) and copy the **Project URL**. It looks like `https://abcdefghijklmnop.supabase.co`.
3. **Secret key**: open **API Keys**. Copy one of these (either works):
   - a **Secret key** (starts with `sb_secret_`; click **Reveal**, or create one first), or
   - on the **Legacy API keys** tab, the **service_role** key (marked **secret**).
4. Do **not** use the "anon" or "publishable" key: those are for browsers and cannot save answers.

Keep the secret key private. Paste it only into Vercel in the next step. Never into the code, GitHub, an email or a chat.

## 4. Add the two values in Vercel

1. Go to https://vercel.com, open the **future-of-jobs** project, then **Settings** → **Environment Variables**.
2. Add the first variable:
   - **Key**: `SUPABASE_URL`
   - **Value**: the Project URL from step 3
   - **Environments**: tick **Production** and **Preview**
3. Click **Save**.
4. Add the second variable the same way:
   - **Key**: `SUPABASE_SERVICE_ROLE_KEY`
   - **Value**: the secret key from step 3
   - **Environments**: tick **Production** and **Preview**
   - Turn on **Sensitive** if Vercel offers it.
5. Click **Save**.

Type the names exactly as shown. They must **not** start with `VITE_`: a `VITE_` name would be built into the website that every visitor downloads. Without it, only the server can read the key.

Leave the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` alone. They are for visitor accounts in the old project.

## 5. Redeploy

New variables apply only to a new deployment.

1. In Vercel, open **Deployments**.
2. Find the newest deployment marked **Production**. Click the **⋯** menu, then **Redeploy**, then **Redeploy** again.
3. Wait until it says **Ready** (about 2 minutes).

## 6. Check that it is on

1. Open https://futureofjobs.vercel.app/api/claude/messages in your browser.
2. You should see `"sharedAnswers":true` and `"missing":[]`.
   - `"missing":["SUPABASE_URL"]` or `["SUPABASE_SERVICE_ROLE_KEY"]` means that name is not set (check the spelling, that **Production** is ticked, and that you redeployed).
   - `"sharedAnswers":true` but the panel note still says "Saving is not set up": the SQL from step 2 was not run in this project, or the key is from a different project.
3. Open any job's Strategic Insight on the live site. The note under the answer says it was saved, with today's date. Open the same job on another device: it opens at once with the same answer and the same date.

That's it. The server also keeps its rate-limit counts in this project from now on.

---

## Good to know

- **Refresh rules.** A saved answer is reused only if the job, the feature, the prompt version, the Claude model, the exact request and the data version all match. The data version (`src/shared/dataVersion.ts`) is built from the BLS and O\*NET data the app shows and the AI-scores file, so when the yearly BLS data is updated, every saved answer is made again. On top of that, an answer older than 90 days is made again and replaces the old one.
- **Change the 90 days** for every answer: add `FOJ_SHARED_MAX_AGE_DAYS` in Vercel (for example `30`), then redeploy. For one feature only (for example the course links in Roadmap and Defend / Build), set `maxAgeDays` in `src/shared/aiFeatures.ts`; the line to change is marked there.
- **Make one answer again now**: `node scripts/shared_answers.mjs delete --role soc:29-1141 --feature roadmap --yes` (see the README). Rarely needed.
- **Free plan pause.** Supabase pauses a free project after about a week with no use. The app keeps working while it is paused (each visitor gets a new answer, and nothing is saved). To wake it, open the project in Supabase and click **Restore project**.
- **Limits are unchanged**: per visitor 30 new answers an hour and 100 a day, and 1,000 for the whole app per day (`FOJ_RATE_PER_HOUR`, `FOJ_RATE_PER_DAY`, `FOJ_RATE_GLOBAL_PER_DAY`). Saved answers never count.
