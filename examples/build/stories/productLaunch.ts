import { timed, type Story } from '../kit'

/**
 * A launch video for Tidewell, a made-up calendar app: no recording at all, only themed scenes, to
 * show that a demo video does not have to start from a screen.
 */
export const productLaunch: Story = {
  id: 'product-launch',
  name: 'Tidewell product launch',
  order: 1,
  version: 1,
  async build(project) {
    const { opening, closing } = project.theme('midnight')
    project.card(opening, 'Introducing Tidewell', 'Introducing Tidewell.')

    await project.html(
      'kinetic-title',
      'Your week, planned for you',
      { title: 'Your week, planned for you', subtitle: 'Tidewell finds the time before the meetings do' },
      "Your calendar fills up with other people's plans. Tidewell fills it with yours."
    )

    project.slide(
      'The average week',
      ['23 meetings', '11 hours of interruptions', '4 hours to actually think'],
      timed('The average week has:', 'twenty-three meetings,', 'eleven hours of interruptions,', 'and just four hours to actually think.')
    )

    await project.html(
      'counter',
      'Focus time won back',
      { value: 6.5, decimals: 1, label: 'hours of focus time won back, every week' },
      'Tidewell protects your focus time automatically. Early teams got back six and a half hours a week.'
    )

    await project.html(
      'bar-chart',
      'Hours won back, by team',
      { title: 'Focus hours won back each week', labels: ['Design', 'Engineering', 'Sales', 'Support'], values: [5, 9, 4, 6], unit: 'h' },
      timed(
        'Every team saw the difference.',
        'Design got five hours back.',
        'Engineering, nine — nearly twice the time to build.',
        'Sales, four.',
        'And support, six.'
      )
    )

    await project.html(
      'before-after',
      'Before and with Tidewell',
      {
        before: { title: 'Before Tidewell', points: ['Meetings land anywhere', 'Deep work defended by hand', 'Overbooked weeks found on Friday'] },
        after: { title: 'With Tidewell', points: ['Meetings moved for you', 'Focus time guarded', 'Overbooking flagged on Monday'] }
      },
      timed(
        'No more defending your calendar by hand.',
        'Tidewell moves meetings, guards deep work, and tells you when a week is overbooked — before it starts.'
      )
    )

    project.card(closing, 'Try Tidewell free', 'Tidewell. Your week, planned for you. Try it free today.')
    project.toEnd(closing.id)
  }
}
