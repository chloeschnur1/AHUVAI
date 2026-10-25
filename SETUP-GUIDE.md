# AHUVAI — Setup & Owner's Guide

This guide is written for you as the owner. No coding knowledge is needed. Where a step
needs a technical person, it says so.

---

## 1. What you have

AHUVAI is one website application with three parts that share one secure database:

| Part | Address (example) | Who uses it |
|---|---|---|
| **Public website** (home, story, services, approach, contact, inquiry form) | `portal.ahuvai.com/` | Anyone |
| **Private Family Portal** (My Family dashboard and the 13-step child questionnaire) | `portal.ahuvai.com/portal` | Families you invite |
| **Administrator Dashboard** (inquiries, families, child profiles, notes) | `portal.ahuvai.com/admin` | You, plus any administrators you add |

### How a family moves through the system

1. A family fills in the **Begin Your Family Experience** inquiry form.
2. It appears in your dashboard under **New Inquiries**. You review it, and mark it *Reviewed* or *Contacted*.
3. When you're ready, you click **Invite to Family Portal**. AHUVAI emails the family a private,
   single-use link. If email isn't set up yet, the dashboard shows you the link so you can send it yourself.
4. The parent creates a password, adds each child, and completes a profile for each one. Answers save as they type.
5. They submit each profile, or all profiles together. You see the family under **Families** and each
   child as a separate profile.
6. You review each child, mark them *Ready for Review* or *More Information Needed*, and keep private notes.

---

## 2. Recommended setup: keep Squarespace, add a secure portal

**Recommendation:** keep your Squarespace site at `ahuvai.com` exactly as it is, and run this
application at a subdomain such as **`portal.ahuvai.com`**.

- Squarespace stays your marketing site. Nothing on it is overwritten.
- On Squarespace, add a navigation link **"Family Portal"** → `https://portal.ahuvai.com/portal`,
  and point your "Begin" or "Inquire" button → `https://portal.ahuvai.com/begin`.
- The portal application also includes complete, matching public pages. Later, if you'd like one
  site instead of two, you can point `ahuvai.com` itself at this application and retire Squarespace.
  This is optional and can wait.

Why not build the portal inside Squarespace? Squarespace can't securely store private child
profiles with per-family access controls. The portal needs its own protected database.

---

## 3. Putting it online (about one hour, once)

These steps use **Render** (render.com), a hosting service with a visual dashboard. It runs the
website and its private PostgreSQL database, encrypts the database at rest, and provides HTTPS
automatically. A technical helper can do this for you in under an hour, or you can follow along.

> I set this up and tested it on a local copy only. I could not create a Render account or
> deploy it for you. The `render.yaml` file follows Render's documented format, but it hasn't
> been run on Render yet.

### Step A — Put the code on GitHub
1. Create a free account at github.com.
2. Create a new **private** repository named `ahuvai`.
3. Upload the project folder (everything except `node_modules` and `.env`).

### Step B — Create the service on Render
1. Create an account at render.com and connect your GitHub account.
2. Choose **New → Blueprint** and select the `ahuvai` repository. Render reads `render.yaml`
   and proposes a web service and a database. Use the paid plans it suggests, because Render's
   free databases expire.
3. Render will ask for a few values:
   - **PUBLIC_URL**: `https://portal.ahuvai.com`
   - **CONTACT_EMAIL**: the address you want shown on the Contact page (optional)
   - Leave the email (SMTP) settings blank for now if you like (see section 6).
4. Click **Apply**. The first build takes a few minutes.

### Step C — Save your encryption key (important)
In Render, open the **ahuvai** service → **Environment**. Copy the value of
**DATA_ENCRYPTION_KEY** into a password manager such as 1Password. This key unlocks every child
profile. **If it is lost, saved profiles cannot be recovered.** Never email it or share it.

### Step D — Connect `portal.ahuvai.com` (needs your approval in Namecheap)
1. In Render, open the service → **Settings → Custom Domains → Add** `portal.ahuvai.com`.
   Render shows you a **CNAME** value, for example `ahuvai.onrender.com`.
2. Find out where your domain's DNS is managed:
   - If your Namecheap domain still uses Namecheap's nameservers: Namecheap → Domain List →
     **Manage** → **Advanced DNS** → **Add New Record** → *CNAME Record*, Host `portal`,
     Value = the address from Render.
   - If you pointed the nameservers to Squarespace, add the same CNAME record in
     Squarespace → **Domains → DNS Settings** instead.
3. Adding a `portal` record **does not affect** `ahuvai.com` or your Squarespace site. Don't
   change or delete any existing records.
4. Within an hour or so, Render shows the domain as verified and issues the HTTPS certificate.

### Step E — Create your administrator account
1. In Render → **Environment**, copy the value of **ADMIN_SETUP_TOKEN**.
2. Visit `https://portal.ahuvai.com/admin`. You'll see **Create the owner account**.
3. Paste the setup code, then enter your name, email, and a strong password.
4. This page works only once. After that, `/admin` shows a normal sign-in page.
5. Go to **Settings → Two-step verification** and turn it on using an authenticator app.
   This is strongly recommended, because the dashboard holds children's health information.

### Step F — Check the status panel
In the dashboard, go to **Settings → System status**. It should say:
*Secure storage: Verified — encryption key loaded, row-level security active.*

If it says **Not ready**, families can still browse the portal, but **profile saving stays switched
off** and families see a clear "Demonstration mode" notice. Nothing sensitive is accepted until the
problem listed there is fixed.

---

## 4. Everyday use of your dashboard

| Section | What it's for |
|---|---|
| **Overview** | Totals (inquiries, new inquiries, active families, child profiles, completed, incomplete) and recent submissions |
| **New Inquiries** | Review requests. Mark *Reviewed*, *Contacted*, *Declined* or *Archived*. **Invite to Family Portal** sends the private invitation |
| **Families** | Search by name or email, and filter by status, destination or travel dates. Open a family to see its record |
| **Family record** | Contact and travel details, a status menu (Contacted → Onboarding → Profiles Submitted → Ready for Review / More Information Needed → Active → Archived), one card per child, private notes, *Send Reminder*, *Request More Information*, *Export Record*, *Delete Family* |
| **Child profile** | All ten sections the parent submitted, with dates. Switch between siblings with the tabs at the top. Incomplete sections are flagged. Your review buttons and private notes are here too |
| **Child Profiles / Submitted Questionnaires** | Every child across all families, with progress and missing sections |
| **Care Preferences** | Allergies, diets, traditions, sensory and comfort needs for every submitted child on one page |
| **Private Feedback** | Notes families send from the portal, plus website contact-form messages |
| **Settings** | Password, two-step verification, other administrators, data retention, demonstration-data removal, activity log |

**Good to know**
- Parents' answers are **read-only** in your dashboard. You can't change them by accident.
- You see exactly what a parent **submitted**. If they edit afterward, you keep seeing the submitted
  version, with a note that changes are pending, until they resubmit.
- You don't see unsubmitted drafts, only which sections are complete. This keeps the parent in
  control of what they share.
- **Private notes are never shown to families**, and they're left out of family exports.
- "Request More Information" emails the family a short note. Please don't type medical details
  into it; ask them to update the portal instead.

---

## 5. Demonstration data — remove before real clients

To try everything with fictional families, a technical helper can run `npm run seed:demo` once
(in Render: service → **Shell**). This creates:

- **The Cohen Family**: three submitted children (David, Leah, Benjamin) going to Paris.
  Portal sign-in: `sarah.cohen.demo@example.com` / `demo-password-cohen`
- **The Levi Family**: one child, profile in progress.
  Portal sign-in: `miriam.levi.demo@example.com` / `demo-password-levi`
- Two demo inquiries and one demo contact message.

Everything demo is labeled **Demo**. When you're done, go to **Settings → Demonstration data →
Remove All Demonstration Data**.

---

## 6. Email (optional, recommended)

Without email, everything still works. Invitations and password-reset links are shown to you
in the dashboard so you can copy them and send them personally.

To send email automatically, sign up with an email-sending provider. Postmark, Resend, or your
Google Workspace SMTP all work. Then fill in these settings in Render → Environment:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (for example,
`AHUVAI <concierge@ahuvai.com>`). Optionally set `OWNER_NOTIFICATION_EMAIL` to receive a short
alert when an inquiry or profile arrives. The provider will ask you to add a few DNS records,
which again doesn't affect your existing website.

Emails never include children's information, only a short note and a sign-in button.

---

## 7. Privacy, security and data care

What is in place, and tested:
- Separate sign-ins for families and administrators. A family session is never accepted on the
  administrator side, or the other way round.
- **Database-level protection** (PostgreSQL row-level security). Even if there were a bug in the
  website code, the database itself only returns a family's own rows. Administrator notes can never
  be read by a family account.
- Questionnaire answers are **encrypted before they are stored** (AES-256), on top of the hosting
  provider's disk encryption. HTTPS is enforced.
- Passwords are stored only as secure hashes. Sign-in attempts are rate-limited and accounts lock
  temporarily after repeated failures.
- No analytics or advertising trackers. Only essential sign-in cookies.
- Health information requires the parent's explicit consent on that page.
- Export (download) or permanently delete any family from its record. An activity log records
  sign-ins, views and changes, never questionnaire content.

What you should still do:
- **Have a lawyer review the Privacy Notice** (`/privacy`). It's an accurate description of how the
  system works, but it isn't legal advice, and your obligations depend on where you and your
  families are based.
- Turn on two-step verification for every administrator.
- Review **Settings → Data retention** every few months.
- Keep your encryption key safe (section 3, Step C).

---

## 8. Photography

The site is designed around luxury travel photography. Until you add photos, elegant illustrated
panels fill those spaces. To add your own licensed images, save them in `public/images/` with
these names (`.jpg` or `.webp`), and they appear automatically after the next deploy:

| File name | Where it appears | Suggested subject |
|---|---|---|
| `hero` | Homepage, questionnaire review | Terrace or villa overlooking the sea |
| `story` | Our Story, questionnaire step 3 | Quiet morning light by a hotel window |
| `tradition` | Homepage, Services, step 10 | Shabbat table with candles and flowers |
| `journey` | Services, step 11 | Clouds through an airplane window |
| `villa` | Services, steps 9 & 12 | Sunlit villa courtyard |
| `residence` | Services, steps 6 & 7 | Calm living room of a private residence |
| `care` | Approach, steps 4 & 8 | Children's books and a blanket on a window seat |
| `portal`, `family` | Questionnaire steps 1 & 2 | Soft travel still life (luggage, linen, flowers) |

Use photos you have the rights to (your own, commissioned, or properly licensed stock). Choose
images that don't show identifiable children unless you have the parents' permission.

---

## 9. If something goes wrong

- **The Settings page says "Secure storage: Not ready"**: the message names the problem. The most
  common one is a missing or changed `DATA_ENCRYPTION_KEY`.
- **The site won't start after deploying**: in Render, open **Logs** and send them to your
  technical helper. If the log mentions SSL, change `DATABASE_SSL` (`off` for Render's internal
  database, `no-verify` for an external database provider).
- **A family lost their invitation**: open the family → **Send / Renew Invitation**.
- **A family forgot their password**: with email set up, they can use "Forgotten your password?"
  on the sign-in page. You can also open their family record → **Password Reset Link**. It emails them
  a link, or, without email, shows you a private link (valid for 48 hours) to send them.
