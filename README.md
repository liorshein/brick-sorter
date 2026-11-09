# Brick Sorter

Photo a pile of LEGO on your phone → pieces are found and identified → you check them → they go into your Rebrickable storage lists, with where each piece belongs.

No server, no build step, no Claude usage. Everything runs in the phone's browser:
- Piece detection: brickscope's detection code (MIT, see LICENSE-brickscope.txt), runs on the phone.
- Recognition: Brickognize's free public API (photos of single pieces are sent there).
- Catalogue and lists: Rebrickable API with your own key. Key and sign-in token are stored only on the phone.

## Put it online (pick one)

**GitHub Pages**
1. Create a new public repo, e.g. `brick-sorter`.
2. Upload every file in this folder (Add file → Upload files → drag them in → Commit).
3. Settings → Pages → Source: Deploy from a branch → `main` / root → Save.
4. After a minute it's live at `https://<your-username>.github.io/brick-sorter/`.

**Netlify**
1. Go to app.netlify.com/drop and drag this folder onto the page.
2. Sign in when asked so the site doesn't expire. You get an `https://….netlify.app` address.

It must be served over https (both options are) for the camera and install to work.

## Install on the Pixel
1. Open the address in Chrome.
2. Menu (⋮) → **Install app** (or **Add to Home screen**).
3. Open Brick Sorter from the home screen. First run: Settings → API key → sign in → Check / create lists.

## Updating
Replace the files in the repo or redeploy. The app picks up the new version the next time it opens with a connection.
