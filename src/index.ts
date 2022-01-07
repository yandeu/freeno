import * as API from './api.js'
import { TinyServerHttp } from 'tiny-http2-server'
import { docker } from './docker'
import { readFileSync } from 'fs'

const server = new TinyServerHttp()
const app = server.route

const config = JSON.parse(readFileSync('config.json', { encoding: 'utf-8' })) as unknown as {
  image: string
  containersMax: number
  timeout: number
  containerConfig: {}
}

const IMAGE = config.image
const CONTAINERS_MAX = config.containersMax

let CONTAINERS_RUNNING = 0
API.containers().then(c => (CONTAINERS_RUNNING = c.length))

const killAndDeleteContainer = async (Id: string) => {
  await docker(`/containers/${Id}/kill`, 'POST')
  await docker(`/containers/${Id}`, 'DELETE')
  console.log('Deleted Container', Id)
}

const getContainersFormatted = async () => {
  const containers = (await API.containers()).map(c => {
    return {
      Id: c.Id,
      Image: c.Image,
      Create: c.Created,
      CreatedISO: new Date(c.Created * 1000).toISOString(),
      AgeSeconds: Math.round(new Date().getTime() / 1000 - c.Created),
      Port: c.Ports[0]?.PublicPort
    }
  })
  CONTAINERS_RUNNING = containers.length
  return containers
}

// dev kill container after 1 minute
setInterval(async () => {
  const containers = await getContainersFormatted()

  for (const c of containers) {
    if (c.AgeSeconds >= 500) {
      await killAndDeleteContainer(c.Id)
    }
  }
}, 10_000)

app.get('/', _ => getContainersFormatted())

app.get('/kill-all', async () => {
  const cs = await API.containers()

  for (const c of cs) {
    await killAndDeleteContainer(c.Id)
  }

  return 'done'
})

app.get('/run', async ctx => {
  if (CONTAINERS_RUNNING >= CONTAINERS_MAX) return ctx.res.status(429).send.text('max containers reached')

  const name = Math.random().toString(36).slice(2)

  // pull images
  const pull = await docker(`/images/create?fromImage=${IMAGE}`, 'POST')

  // create
  const create = (await docker(`/containers/create?${name}`, 'POST', {
    Image: IMAGE,
    ...config.containerConfig
  })) as any

  // TODO(yandeu):
  // if res is { "message": "No such image: ubuntu:latest" },
  // pull the image and try to create it again

  // run
  if (!create || !create.Id) return create

  const start = await docker(`/containers/${create.Id}/start?itd`, 'POST')

  const json = (await docker(`/containers/${create.Id}/json`)) as any
  const hostPort = json?.NetworkSettings?.Ports?.['3000/tcp']?.[0].HostPort
  console.log('hostPort', hostPort)

  return json
})

server.listen(3080).then(port => {
  console.log(`http://127.0.0.1:${port}`)
})
