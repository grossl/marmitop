import { healthResponse } from './health'

const port = Number(process.env.HEALTH_PORT ?? 8181)

Bun.serve({
  port,
  fetch: () => healthResponse(),
})

// Placeholder: the pgmq consumer loop arrives with the queue milestone.
setInterval(() => {}, 60_000)

console.log(`worker health on :${port}`)
