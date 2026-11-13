# Collective Volunteer App

Sunday volunteer guide and checklists for The Collective Church. One link volunteers open on their phones.

## What is here

```
index.html           Page shell and all styling (branding, phone layout, A4 print)
app.js               The app: area picker, guides, tick-off checklists, editing, sign-up, team space
config.js            Supabase URL and public key for the live site (empty = local preview)
data/seed.json       Starting content for every area (what local preview shows)
img/                 12 Presenter screenshots used by the slides guide (1352 x 848 JPG)
supabase/schema.sql  Database tables, access rules and the screenshot bucket
```

## How it works

- **Hosting:** static files on GitHub Pages. **Data:** a Supabase project (content, editors, sign-ups, uploaded pictures).
- **Areas:** slides, oversight and welcoming, tech, kids church, tea/coffee and setup. Each is one row in `areas`, with its guide stored as JSON in `content`.
- **Volunteer links:** each area has an unguessable link (`?k=…`) that opens only that area, no sign-in. The overseer link opens every area. The phone remembers the link.
- **Editing:** people in the `people` table sign in with an emailed link. An overseer (`is_admin`) edits everything and manages the list under Team space → Who can edit. Others edit only the areas ticked for them. "Can see sign-ups" is a separate right.
- **Sign-up:** `#/signup` is public. Anyone can send a sign-up; only overseers and people with the sign-ups right can read them, change status, export CSV or delete.
- **Checklist ticks** are kept on the volunteer's own phone and start fresh each day.
- **Local preview:** serve this folder on localhost with `config.js` empty. Everything runs from `data/seed.json` and saves only in that browser. `?k=demo-slides` shows a volunteer view, `?k=demo-all` the overseer view.

## Content structure (per area)

`content.sections[]`. Each section has `id`, `title`, optional `intro`, and one of:

- `type: "role"` with `items[]` of `{title, text}`: short note cards.
- `groups[]`: step-by-step processes. Each group has `id`, `title`, optional `tip`, and `steps[]`:
  - `h`: the bold instruction, `p`: optional supporting line
  - `img`: `img/…` in this repo, or the URL of an uploaded picture
  - `marks[]`: gold circles on the screenshot. `x`, `y` are percentages (centre), `n` is the number. `{box:true,x,y,w,h}` draws a rectangle. Marks are only set by hand in the JSON; pictures uploaded from a phone have none.
- `type: "checklist"` with `items[]` of `{t, s}`.
- `order[]` (slides only): the weekly running order. Not editable in the app yet.

Text may contain `<span class='k'>Button</span>` and `<b>bold</b>` only; anything else is shown as plain text. In the editor these are typed as `[Button]` and `*bold*`. Parts and steps are numbered automatically.

## Design decisions

- Branding from The Collective Church style guide (Canva):
  - Colours: cream `#F1EDE9`, gold `#CA8D32`, brown `#754C24`, black `#000000`, white `#FFFFFF`
  - Fonts: Futura PT (headings), Europa Light (body), High Empathy (script accent). The page uses free look-alikes from Google Fonts: Jost, Mulish, Mrs Saint Delafield.
- Phone first. One step per card: bold instruction, then a full-width screenshot. Landscape uses the full width.
- Tap a screenshot to open it full screen with pinch zoom and + / − buttons.
- A4 print stylesheet: two-column step cards, page breaks per part, no phone-only UI. Print from the browser menu.

## Facts about the Sunday slides process (Presenter by WorshipTools)

- Desktop app on the church Mac. Volunteers can also log in at home with their own login.
- Song template is set per song: Edit → Edit song slides → Song Template = "Collective Template" (capitals, dark see-through strip behind each line).
- Song backgrounds: Edit → Edit service item → Source "Media from your library" → Select. Numbered set 01 Graphite to 12 Warm Pewter (there is no 08 in the library).
- A new service item is inserted directly after the currently selected item. Items can be dragged to reorder.
- Weekly running order: Welcome (DARK or LIGHT, volunteer's choice), New to The Collective, Upcoming events (if any), Home Church, Giving, Song 1, Song 2, The Collective Kids, remaining songs, Preacher's PowerPoint (if any, background source None).
- Preacher's PowerPoint: Slides type → Select → Add Slides → Import PowerPoint/Keynote.
- Laptop to TV: plug the HDMI cable into the laptop, then select HDMI 1 on the television.

## Not yet done

- Tech, kids church and tea/coffee guides are one-line starters for their leads to fill in. Oversight and welcoming is a draft to review.
- Drawing gold marks on pictures from a phone, adding a brand-new area from the app, and notifications for new sign-ups.
