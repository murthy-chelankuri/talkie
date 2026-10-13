import { serveApp } from '../serveApp'
import type { Story } from '../kit'

/**
 * Taskboard, recorded by Talkie's own recorder: a real session, clicks and all, so the picture
 * leans in on each click the way it does for anyone's recording. The app starts the same every
 * time, so a rebuild records the same board.
 */
export const appWalkthrough: Story = {
  id: 'app-walkthrough',
  name: 'Taskboard walkthrough',
  order: 2,
  version: 1,
  async build(project) {
    const { opening, closing } = project.theme('sand')
    project.card(
      opening,
      'Taskboard in a minute',
      "Here's Taskboard, a simple way to see your team's work at a glance — in one minute."
    )

    const app = await serveApp('taskboard')
    try {
      await project.recording(app.url, [
        {
          narration:
            "Every piece of work is a card, and every card lives in a column: what's waiting, what's in progress, and what's finished."
        },
        {
          narration: 'Adding work takes a second. Press New task, give it a name, and it lands in To do.',
          act: async (page) => {
            await page.waitForTimeout(600)
            await page.getByRole('button', { name: 'New task' }).click()
            await page.getByRole('textbox', { name: 'Task name' }).pressSequentially('Write the launch post', { delay: 70 })
            await page.waitForTimeout(400)
            await page.getByRole('button', { name: 'Add', exact: true }).click()
          }
        },
        {
          narration: "When you pick something up, press Start. The card moves across, so everyone can see who's on what.",
          act: async (page) => {
            await page.waitForTimeout(1500)
            await page.getByRole('button', { name: 'Start: Write the launch post' }).click()
          }
        },
        {
          narration: 'Finish it, and it moves to Done — and the bar along the top shows how far through the week you are.',
          act: async (page) => {
            await page.waitForTimeout(1200)
            await page.getByRole('button', { name: 'Done: Write the launch post' }).click()
          }
        },
        {
          narration: 'And when you just need your own list, Mine hides everything else.',
          act: async (page) => {
            await page.waitForTimeout(1500)
            await page.getByRole('button', { name: 'Mine', exact: true }).click()
          }
        }
      ])
    } finally {
      await app.close()
    }

    project.card(
      closing,
      'Recorded once. Narrated by Talkie.',
      'That walkthrough was recorded in one take, without a word said. The words came afterwards, and the picture leans in wherever a click landed.'
    )
    project.toEnd(closing.id)
  }
}
