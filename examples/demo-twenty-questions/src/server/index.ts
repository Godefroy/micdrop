// Load environment variables before importing anything else
import * as dotenv from 'dotenv'
dotenv.config()

import fastifyWebsocket from '@fastify/websocket'
import fastify from 'fastify'
import call from './call'

const PORT = Number(process.env.PORT || 8097)

const server = fastify({ logger: false })

server.register(fastifyWebsocket, {
  errorHandler(error, socket) {
    console.error(error)
    socket.close(1011)
  },
})

server.register(call)

async function start() {
  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`Twenty questions is listening on port ${PORT}`)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}

start()
