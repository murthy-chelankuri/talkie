import { timed, type Story } from '../kit'
import { filmAndCut } from '../tour/tour'

/**
 * What Talkie does, shown by doing it: one project made from nothing, every capability met in the
 * order someone would meet it. The footage is the real app, filmed by tour/filmTour.ts — reused
 * from the last filming unless REFILM=1 — so the tour shows the app that ships, and films it again
 * when that app changes how it looks.
 *
 * Each line is written for the shot under it and to fit inside it; a line that outruns its shot
 * holds the last frame, which the build reports.
 */
export const meetTalkie: Story = {
  id: 'meet-talkie',
  name: 'Meet Talkie',
  order: 0,
  version: 2,
  async build(project) {
    const shots = await filmAndCut()
    const shot = (name: string, narration: string): void => {
      const cut = shots.get(name)
      if (!cut) throw new Error(`The tour has no shot called "${name}"`)
      project.footage(cut, narration)
    }

    const { opening, closing } = project.theme('graphite')
    project.card(
      opening,
      'Meet Talkie',
      "This is Talkie. It turns a silent recording of your app into a narrated demo video. Here's one being made, from nothing."
    )

    await project.diagram(
      'From app to video',
      'graph LR\n  record[Record] --> write[Write]\n  write --> voice[Voice]\n  voice --> export[Export]',
      timed(
        'It takes four steps.',
        'Record the app.',
        'Write the words.',
        'Give them a voice.',
        'And export the video.'
      )
    )

    shot('new-project', "Everything starts with a project. Give it a name, and say in a sentence what it's about — the narration is written from that.")
    shot('record', 'Then record your app.')
    shot('toolbar', 'Type its address, tick Show me round it, and Talkie walks the app by itself.')
    shot('recorded', 'The recording comes back cut into scenes, and the picture leans in wherever a click landed.')

    shot('write', 'Press Write the words, and your AI drafts the narration for every scene.')
    shot('written', 'The script shows it all in one column. The numbers in brackets are timings: each line is spoken at that second of its scene.')

    shot('voice', 'Choose a voice — the Mac’s own, or Kokoro, built in and close to a person — and press Speak.')
    shot('voiced', 'Every scene gets its own take, and the scene is sized to fit it.')

    shot('slide', "Not every scene is a recording. Add a slide, say what should be on it, and the AI writes it.")
    shot('slide-written', 'Its points appear as they are spoken.')
    shot('diagram', 'Diagrams are written in Mermaid, and drawn box by box, in the order the narration names them.')
    shot('html', 'An HTML scene is a web page played frame by frame. Start from a template, and ask the AI to make it yours.')
    shot('html-changed', 'Every scene is checked before it reaches the timeline: that it runs, stays in its sandbox, and fits the frame.')

    shot(
      'settings',
      'Settings decide who writes and who speaks — Claude, Copilot or a local model; the Mac’s voices or Kokoro. Recording sets the click highlight, Export can burn in captions, and System lets AI agents connect.'
    )
    shot('theme', 'A theme is a company’s look. Give Talkie a website, and it reads the real colours, fonts and logo.')
    shot('theme-made', 'Every colour is checked so text stays readable.')
    shot('theme-applied', 'Choose it for the project, and the whole video takes it on — with an opening and a closing card added for you.')

    shot('agent', 'Or just ask. The agent changes the whole project, using the same tools Talkie offers any AI agent.')
    shot('agent-done', 'And the introduction is written, placed and given its words.')

    shot('export', 'Export shows its progress, and how long is left.')
    shot('exported', 'And there is the video, with captions beside it.')

    project.card(
      closing,
      'Make it yours',
      'The other examples show a product launch, an app walkthrough and an architecture explainer. Open one, change a word, and press Speak.'
    )
    project.toEnd(closing.id)
  }
}
