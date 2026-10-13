// Taskboard: a small, made-up app that ships with Talkie so its examples have something real to
// record. Everything lives in memory and starts the same every time, so a recording made today
// and one made next year show the same board.

const people = {
  P: { name: 'Priya', className: 'a1', what: 'Design' },
  S: { name: 'Sam', className: 'a2', what: 'Engineering' },
  L: { name: 'Lena', className: 'a3', what: 'Marketing' },
  T: { name: 'Tom', className: 'a4', what: 'Support' }
}
const ME = 'P'

let tasks = [
  { id: 1, title: 'Draft the release notes', tag: 'Writing', who: 'L', column: 'todo' },
  { id: 2, title: 'Final check of the pricing page', tag: 'Web', who: 'P', column: 'todo' },
  { id: 3, title: 'Record the product demo', tag: 'Video', who: 'P', column: 'todo' },
  { id: 4, title: 'Fix the sign-up email', tag: 'Bug', who: 'S', column: 'doing' },
  { id: 5, title: 'New onboarding screens', tag: 'Design', who: 'P', column: 'doing' },
  { id: 6, title: 'Update the help centre', tag: 'Support', who: 'T', column: 'doing' },
  { id: 7, title: 'Choose the launch date', tag: 'Planning', who: 'L', column: 'done' },
  { id: 8, title: 'Ship the new dashboard', tag: 'Web', who: 'S', column: 'done' },
  { id: 9, title: 'Brief the support team', tag: 'Support', who: 'T', column: 'done' }
]
let nextId = 10
let filter = 'all'

const NEXT = { todo: { to: 'doing', label: 'Start' }, doing: { to: 'done', label: 'Done' } }

function renderBoard() {
  for (const column of document.querySelectorAll('.column')) {
    const name = column.dataset.column
    const list = column.querySelector('ul')
    const shown = tasks.filter((task) => task.column === name && (filter === 'all' || task.who === ME))
    column.querySelector('.count').textContent = shown.length
    list.replaceChildren(
      ...shown.map((task) => {
        const item = document.createElement('li')
        item.className = 'card'
        item.dataset.id = task.id
        const person = people[task.who]
        item.innerHTML = `
          <span class="title"></span>
          <span class="row">
            <span class="avatar ${person.className}" title="${person.name}">${task.who}</span>
            <span class="tag"></span>
          </span>`
        item.querySelector('.title').textContent = task.title
        item.querySelector('.tag').textContent = task.tag
        const next = NEXT[task.column]
        if (next) {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'move'
          button.textContent = next.label
          button.setAttribute('aria-label', `${next.label}: ${task.title}`)
          button.addEventListener('click', () => {
            task.column = next.to
            renderBoard()
          })
          item.querySelector('.row').append(button)
        }
        return item
      })
    )
  }
  const done = tasks.filter((task) => task.column === 'done').length
  document.getElementById('progress-fill').style.width = `${Math.round((done / tasks.length) * 100)}%`
  document.getElementById('progress-text').textContent = `${done} of ${tasks.length} done this week`
}

function renderTeam() {
  document.getElementById('people').replaceChildren(
    ...Object.entries(people).map(([initial, person]) => {
      const mine = tasks.filter((task) => task.who === initial)
      const item = document.createElement('li')
      item.innerHTML = `
        <span class="avatar ${person.className}">${initial}</span>
        <span><strong>${person.name}</strong><span class="what">${person.what}</span></span>
        <span class="load">${mine.filter((task) => task.column !== 'done').length} open<br>${mine.filter((task) => task.column === 'done').length} done</span>`
      return item
    })
  )
}

function renderReports() {
  const days = [['Mon', 3], ['Tue', 5], ['Wed', 4], ['Thu', 7], ['Fri', 6]]
  const most = Math.max(...days.map(([, count]) => count))
  document.getElementById('chart').replaceChildren(
    ...days.map(([day, count]) => {
      const bar = document.createElement('div')
      bar.innerHTML = `<span>${count}</span><i style="height:${(count / most) * 80}%"></i><span>${day}</span>`
      return bar
    })
  )
}

function show(view) {
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view
  for (const tab of document.querySelectorAll('.views a')) tab.setAttribute('aria-selected', String(tab.dataset.view === view))
  if (view === 'team') renderTeam()
  if (view === 'reports') renderReports()
}

window.addEventListener('hashchange', () => show(location.hash.slice(1) || 'board'))

for (const button of document.querySelectorAll('.filter button')) {
  button.addEventListener('click', () => {
    filter = button.dataset.filter
    for (const other of document.querySelectorAll('.filter button')) other.setAttribute('aria-pressed', String(other === button))
    renderBoard()
  })
}

const form = document.getElementById('new-form')
document.getElementById('new-task').addEventListener('click', () => {
  form.hidden = false
  document.getElementById('new-title').focus()
})
form.addEventListener('submit', (event) => {
  event.preventDefault()
  const input = document.getElementById('new-title')
  const title = input.value.trim()
  if (!title) return
  tasks = [{ id: nextId++, title, tag: 'New', who: ME, column: 'todo' }, ...tasks]
  input.value = ''
  form.hidden = true
  renderBoard()
})

renderBoard()
show(location.hash.slice(1) || 'board')
