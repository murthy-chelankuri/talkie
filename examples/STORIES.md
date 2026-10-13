# The example stories

The words each example speaks, scene by scene. The build scripts in `examples/build/stories/` hold the
same words with their timings; this is the version to read and argue with.

Voice: Kokoro, af_heart. Roughly 2.9 words a second, so each scene's clip is sized to its words.

---

## 1. Meet Talkie — about 3½ minutes

What Talkie does, shown by doing it. The footage is the real app, filmed by
`examples/build/tour/filmTour.ts` (again with `REFILM=1`): one project made from nothing, every capability in the order
someone would meet it. The waits — the walk, drafting, voicing, exporting — are cut out.

| # | On screen | Narration |
|---|---|---|
| 1 | **Title card:** "Meet Talkie" | This is Talkie. It turns a silent recording of your app into a narrated demo video. Here's one being made, from nothing. |
| 2 | **Diagram**, drawn step by step: Record → Write → Voice → Export | It takes four steps. Record the app. Write the words. Give them a voice. And export the video. |
| 3 | New project: a name, and what it's about | Everything starts with a project. Give it a name, and say in a sentence what it's about — the narration is written from that. |
| 4 | Add → Record a session | Then record your app. |
| 5 | The recording toolbar: Taskboard's address, Show me round it | Type its address, tick Show me round it, and Talkie walks the app by itself. |
| 6 | The walk's scenes on the timeline, playing with click zoom | The recording comes back cut into scenes, and the picture leans in wherever a click landed. |
| 7 | Write the words | Press Write the words, and your AI drafts the narration for every scene. |
| 8 | The script view, with timings | The script shows it all in one column. The numbers in brackets are timings: each line is spoken at that second of its scene. |
| 9 | The Voice panel; Speak | Choose a voice — the Mac's own, or Kokoro, built in and close to a person — and press Speak. |
| 10 | Every clip voiced, waveforms in place | Every scene gets its own take, and the scene is sized to fit it. |
| 11 | Add a scene → Slide, asking the AI to write it | Not every scene is a recording. Add a slide, say what should be on it, and the AI writes it. |
| 12 | The slide's points | Its points appear as they are spoken. |
| 13 | A Mermaid diagram typed in | Diagrams are written in Mermaid, and drawn box by box, in the order the narration names them. |
| 14 | An HTML template, changed with AI | An HTML scene is a web page played frame by frame. Start from a template, and ask the AI to make it yours. |
| 15 | The changed scene, checked | Every scene is checked before it reaches the timeline: that it runs, stays in its sandbox, and fits the frame. |
| 16 | Settings: AI, Recording, Export, System (agents switched on) | Settings decide who writes and who speaks — Claude, Copilot or a local model; the Mac's voices or Kokoro. Recording sets the click highlight, Export can burn in captions, and System lets AI agents connect. |
| 17 | Themes → Create with AI from Taskboard's site | A theme is a company's look. Give Talkie a website, and it reads the real colours, fonts and logo. |
| 18 | The theme, saved | Every colour is checked so text stays readable. |
| 19 | About this project → Theme; the video restyles, cards added | Choose it for the project, and the whole video takes it on — with an opening and a closing card added for you. |
| 20 | Agent: "Add a short introduction…" | Or just ask. The agent changes the whole project, using the same tools Talkie offers any AI agent. |
| 21 | The introduction slide arrives | And the introduction is written, placed and given its words. |
| 22 | Export, with progress | Export shows its progress, and how long is left. |
| 23 | "Video exported" | And there is the video, with captions beside it. |
| 24 | **Closing card:** "Make it yours" | The other examples show a product launch, an app walkthrough and an architecture explainer. Open one, change a word, and press Speak. |


---

## 2. Product launch — about 60 seconds

A launch video for **Lumen**, a made-up calendar app, with no recording at all: themed scenes,
three of them HTML. Theme: *Midnight*.

| # | On screen | Narration |
|---|---|---|
| 1 | **Opening card:** "Introducing Lumen" | Introducing Lumen. |
| 2 | **Kinetic title:** "Your week, planned for you" · "Lumen finds the time before the meetings do" | Your calendar fills up with other people's plans. Lumen fills it with yours. |
| 3 | **Slide:** "The average week" · 23 meetings · 11 hours of interruptions · 4 hours to actually think | The average week has: twenty-three meetings, eleven hours of interruptions, and just four hours to actually think. |
| 4 | **Big number:** counts up to 6.5 · "hours of focus time won back, every week" | Lumen protects your focus time automatically. Early teams got back six and a half hours a week. |
| 5 | **Bar chart:** "Focus hours won back each week" — Design 5, Engineering 9, Sales 4, Support 6, each bar as it is named | Every team saw the difference. Design got five hours back. Engineering, nine — nearly twice the time to build. Sales, four. And support, six. |
| 6 | **Before and after:** "Before Lumen" wipes to "With Lumen" | No more defending your calendar by hand. Lumen moves meetings, guards deep work, and tells you when a week is overbooked — before it starts. |
| 7 | **Closing card:** "Try Lumen free" | Lumen. Your week, planned for you. Try it free today. |

---

## 3. App walkthrough — about 60 seconds

**Taskboard**, the demo app that ships with Talkie, recorded through Talkie's own recorder in one
take, clicks and all, so the picture leans in on each click. Each scene is marked as it starts, as
the toolbar's mark button does, and the recording is cut at the marks. Theme: *Sand*.

| # | On screen (recorded) | Narration |
|---|---|---|
| 1 | **Opening card:** "Taskboard in a minute" | Here's Taskboard, a simple way to see your team's work at a glance — in one minute. |
| 2 | The board: To do, Doing, Done | Every piece of work is a card, and every card lives in a column: what's waiting, what's in progress, and what's finished. |
| 3 | **New task**, "Write the launch post", Add | Adding work takes a second. Press New task, give it a name, and it lands in To do. |
| 4 | **Start** on the new card; it moves to Doing | When you pick something up, press Start. The card moves across, so everyone can see who's on what. |
| 5 | **Done** on it; the progress bar fills | Finish it, and it moves to Done — and the bar along the top shows how far through the week you are. |
| 6 | **Mine**; only your cards remain | And when you just need your own list, Mine hides everything else. |
| 7 | **Closing card:** "Recorded once. Narrated by Talkie." | That walkthrough was recorded in one take, without a word said. The words came afterwards, and the picture leans in wherever a click landed. |

---

## 4. Architecture explainer — about 70 seconds

How a photo upload travels through a system: diagrams drawn box by box as each part is named, and
the code lit up a line at a time. Theme: *Graphite*.

| # | On screen | Narration |
|---|---|---|
| 1 | **Opening card:** "Where does a photo go?" | What actually happens when you upload a photo? Let's follow one, end to end. |
| 2 | **Diagram**, drawn step by step: Phone → API gateway → Upload service → Object storage | It starts on the phone. The photo goes to the API gateway, which checks who you are. The upload service gives it a name, and stores the original in object storage — then replies straight away, so you're never left waiting. |
| 3 | **Diagram**, drawn step by step: Object storage → Queue → Thumbnailer → CDN | The slow work happens afterwards, from the stored original. A message goes onto a queue. The thumbnailer picks it up and makes the smaller sizes, and publishes them to the CDN, close to whoever's looking. |
| 4 | **Code walkthrough:** "The upload handler", each line lit as it is named | In code, it's short. Check the user. Store the original. Queue the thumbnails. And reply. Nothing waits on the slow part. |
| 5 | **Slide:** "Why it's built this way" · Fast replies · Retries for free · Scales one piece at a time | Built this way, uploads stay fast, a failed thumbnail is simply retried, and each piece can grow on its own. |
| 6 | **Closing card:** "Explained in sixty seconds" | That's one upload, end to end — drawn and narrated, step by step, in Talkie. |
