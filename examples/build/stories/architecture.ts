import { timed, type Story } from '../kit'

/**
 * How a photo upload travels through a system: diagrams drawn box by box as each part is named,
 * and the code lit up a line at a time. The kind of explainer an engineer would otherwise draw on
 * a whiteboard and lose.
 */
export const architecture: Story = {
  id: 'architecture-explainer',
  name: 'Where does a photo go?',
  order: 3,
  version: 1,
  async build(project) {
    const { opening, closing } = project.theme('graphite')
    project.card(
      opening,
      'Where does a photo go?',
      "What actually happens when you upload a photo? Let's follow one, end to end."
    )

    await project.diagram(
      'The upload',
      'graph LR\n  phone[Phone] --> gateway[API gateway]\n  gateway --> upload[Upload service]\n  upload --> storage[(Object storage)]',
      timed(
        'It starts on the phone.',
        'The photo goes to the API gateway, which checks who you are.',
        'The upload service gives it a name,',
        "and stores the original in object storage — then replies straight away, so you're never left waiting."
      )
    )

    await project.diagram(
      'Afterwards',
      'graph LR\n  storage[(Object storage)] --> queue[Queue]\n  queue --> thumbs[Thumbnailer]\n  thumbs --> cdn[CDN]',
      timed(
        'The slow work happens afterwards, from the stored original.',
        'A message goes onto a queue.',
        'The thumbnailer picks it up and makes the smaller sizes,',
        "and publishes them to the CDN, close to whoever's looking."
      )
    )

    await project.html(
      'code-walkthrough',
      'The upload handler',
      {
        title: 'The upload handler',
        code: [
          'async function upload(request) {',
          '  const user = await auth.check(request)',
          '  const key = await storage.put(user, request.photo)',
          "  await queue.send('thumbnails', { key })",
          "  return { status: 'stored', key }",
          '}'
        ].join('\n'),
        highlights: [[2, 2], [3, 3], [4, 4], [5, 5]]
      },
      timed("In code, it's short.", 'Check the user.', 'Store the original.', 'Queue the thumbnails.', 'And reply. Nothing waits on the slow part.')
    )

    project.slide(
      "Why it's built this way",
      ['Fast replies', 'Retries for free', 'Scales one piece at a time'],
      timed(
        'Built this way,',
        'uploads stay fast,',
        'a failed thumbnail is simply retried,',
        'and each piece can grow on its own.'
      )
    )

    project.card(closing, 'Explained in sixty seconds', "That's one upload, end to end — drawn and narrated, step by step, in Talkie.")
    project.toEnd(closing.id)
  }
}
