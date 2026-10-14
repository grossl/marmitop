import { app } from './app'

const port = Number(process.env.PORT ?? 3101)

export default { port, fetch: app.fetch }
